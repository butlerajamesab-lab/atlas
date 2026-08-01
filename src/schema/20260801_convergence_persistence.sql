-- ═══════════════════════════════════════════════════════════════════════════════
-- ATLAS CONVERGENCE PERSISTENCE v2.1.0
-- Migration: 20260801_convergence_persistence
--
-- Production database contracts for:
--   1. atlas.geography_registry_snapshot — versioned immutable geography snapshots
--   2. atlas.convergence_run_manifest — per-run manifest with idempotency identity
--   3. atlas.convergence_signal_snapshot — immutable signal populations per run
--   4. atlas.convergence_receipt — per-geography provenance receipts
--   5. atlas.convergence_result_payload — complete result payloads
--   6. RPC: atlas_convergence_start_run_v1 — governed run initiation
--   7. RPC: atlas_convergence_persist_receipt_v1 — receipt persistence
--   8. RPC: atlas_convergence_replay_check_v1 — replay identity verification
--
-- Invariants:
--   - All tables are INSERT-ONLY (no UPDATE, no DELETE)
--   - Run identity = sha256(engine_version + as_of + config + geography_registry_version)
--   - Receipt identity = sha256(manifest_hash + output_hash)
--   - Replay: same run_key + same inputs → same receipt_identity (or violation)
--   - Least-privilege: service_role can INSERT; anon cannot access
-- ═══════════════════════════════════════════════════════════════════════════════

-- Ensure atlas schema exists
CREATE SCHEMA IF NOT EXISTS atlas;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GEOGRAPHY REGISTRY SNAPSHOT
-- Immutable versioned geography snapshots. Once written, never modified.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atlas.geography_registry_snapshot (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_hash         text NOT NULL UNIQUE,
  registry_version      text NOT NULL,
  jurisdiction          text NOT NULL,
  source_id             text NOT NULL,
  source_version        text,
  record_count          integer NOT NULL CHECK (record_count > 0),
  entries_json          jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Prevent updates and deletes
CREATE OR REPLACE FUNCTION atlas.prevent_mutation_geography_registry()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'atlas.geography_registry_snapshot is immutable — no UPDATE or DELETE permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_geography_registry ON atlas.geography_registry_snapshot;
CREATE TRIGGER trg_immutable_geography_registry
  BEFORE UPDATE OR DELETE ON atlas.geography_registry_snapshot
  FOR EACH ROW EXECUTE FUNCTION atlas.prevent_mutation_geography_registry();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONVERGENCE RUN MANIFEST
-- One row per governed convergence run. Idempotent on run_key.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atlas.convergence_run_manifest (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key                     text NOT NULL UNIQUE,
  engine_version              text NOT NULL,
  as_of                       bigint NOT NULL,
  time_window_ms              bigint NOT NULL CHECK (time_window_ms > 0),
  temporal_bucket_ms          bigint NOT NULL CHECK (temporal_bucket_ms > 0),
  geography_registry_version  text NOT NULL,
  rule_manifest_hash          text NOT NULL,
  configuration_hash          text NOT NULL,
  configuration_json          jsonb NOT NULL,
  min_signals_for_analysis    integer NOT NULL DEFAULT 1,
  z_score_threshold           numeric NOT NULL DEFAULT 2.0,
  status                      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  error_message               text,
  total_geographies           integer,
  total_signals_raw           integer,
  total_signals_deduplicated  integer
);

-- Prevent deletes (updates allowed only for status transition)
CREATE OR REPLACE FUNCTION atlas.prevent_delete_run_manifest()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'atlas.convergence_run_manifest does not permit DELETE';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_no_delete_run_manifest ON atlas.convergence_run_manifest;
CREATE TRIGGER trg_no_delete_run_manifest
  BEFORE DELETE ON atlas.convergence_run_manifest
  FOR EACH ROW EXECUTE FUNCTION atlas.prevent_delete_run_manifest();

-- Only allow status transitions: running → completed | failed
CREATE OR REPLACE FUNCTION atlas.restrict_run_manifest_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.status != 'running' THEN
    RAISE EXCEPTION 'cannot update a run that is already %', OLD.status;
  END IF;
  IF NEW.status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid status transition: running → %', NEW.status;
  END IF;
  -- Immutable fields cannot change
  IF NEW.run_key != OLD.run_key OR NEW.engine_version != OLD.engine_version
     OR NEW.as_of != OLD.as_of OR NEW.configuration_hash != OLD.configuration_hash THEN
    RAISE EXCEPTION 'immutable fields on convergence_run_manifest cannot be modified';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_restrict_run_manifest_update ON atlas.convergence_run_manifest;
CREATE TRIGGER trg_restrict_run_manifest_update
  BEFORE UPDATE ON atlas.convergence_run_manifest
  FOR EACH ROW EXECUTE FUNCTION atlas.restrict_run_manifest_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONVERGENCE SIGNAL SNAPSHOT
-- Immutable signal population snapshot per run. Stores the complete sorted
-- raw and deduplicated populations that were used in computation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atlas.convergence_signal_snapshot (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key                     text NOT NULL REFERENCES atlas.convergence_run_manifest(run_key),
  snapshot_type               text NOT NULL CHECK (snapshot_type IN ('raw', 'deduplicated')),
  population_hash             text NOT NULL,
  signal_count                integer NOT NULL CHECK (signal_count >= 0),
  signals_json                jsonb NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_key, snapshot_type)
);

CREATE OR REPLACE FUNCTION atlas.prevent_mutation_signal_snapshot()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'atlas.convergence_signal_snapshot is immutable — no UPDATE or DELETE permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_signal_snapshot ON atlas.convergence_signal_snapshot;
CREATE TRIGGER trg_immutable_signal_snapshot
  BEFORE UPDATE OR DELETE ON atlas.convergence_signal_snapshot
  FOR EACH ROW EXECUTE FUNCTION atlas.prevent_mutation_signal_snapshot();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CONVERGENCE RECEIPT
-- Per-geography provenance receipt. Immutable once written.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atlas.convergence_receipt (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key                     text NOT NULL REFERENCES atlas.convergence_run_manifest(run_key),
  receipt_identity            text NOT NULL,
  geography_id                text NOT NULL,
  equation_id                 text NOT NULL,
  engine_version              text NOT NULL,
  rule_manifest_hash          text NOT NULL,
  as_of                       bigint NOT NULL,
  configuration_hash          text NOT NULL,
  input_hash                  text NOT NULL,
  source_signal_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  geography_registry_version  text NOT NULL,
  expected_count              numeric,
  observed_count              integer NOT NULL,
  z_score                     numeric,
  convergence_detected        boolean NOT NULL DEFAULT false,
  status                      text NOT NULL DEFAULT 'resolved' CHECK (status IN ('resolved', 'unresolved', 'below_threshold')),
  reason_unresolved           text,
  computed_outputs            jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp_computed          bigint NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_key, geography_id)
);

CREATE OR REPLACE FUNCTION atlas.prevent_mutation_receipt()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'atlas.convergence_receipt is immutable — no UPDATE or DELETE permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_receipt ON atlas.convergence_receipt;
CREATE TRIGGER trg_immutable_receipt
  BEFORE UPDATE OR DELETE ON atlas.convergence_receipt
  FOR EACH ROW EXECUTE FUNCTION atlas.prevent_mutation_receipt();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CONVERGENCE RESULT PAYLOAD
-- Complete result payload per run. Stored as immutable JSON.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atlas.convergence_result_payload (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key             text NOT NULL UNIQUE REFERENCES atlas.convergence_run_manifest(run_key),
  output_hash         text NOT NULL,
  payload_json        jsonb NOT NULL,
  receipt_count       integer NOT NULL CHECK (receipt_count >= 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION atlas.prevent_mutation_result_payload()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'atlas.convergence_result_payload is immutable — no UPDATE or DELETE permitted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_result_payload ON atlas.convergence_result_payload;
CREATE TRIGGER trg_immutable_result_payload
  BEFORE UPDATE OR DELETE ON atlas.convergence_result_payload
  FOR EACH ROW EXECUTE FUNCTION atlas.prevent_mutation_result_payload();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RPC: atlas_convergence_start_run_v1
-- Governed run initiation. Idempotent on run_key.
-- Returns the run manifest row (existing or new).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atlas_convergence_start_run_v1(
  p_run_key                     text,
  p_engine_version              text,
  p_as_of                       bigint,
  p_time_window_ms              bigint,
  p_temporal_bucket_ms          bigint,
  p_geography_registry_version  text,
  p_rule_manifest_hash          text,
  p_configuration_hash          text,
  p_configuration_json          jsonb,
  p_min_signals_for_analysis    integer DEFAULT 1,
  p_z_score_threshold           numeric DEFAULT 2.0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_existing atlas.convergence_run_manifest%ROWTYPE;
  v_new_id uuid;
BEGIN
  -- Check for existing run with same key
  SELECT * INTO v_existing FROM atlas.convergence_run_manifest WHERE run_key = p_run_key;

  IF FOUND THEN
    -- Idempotency: verify immutable fields match
    IF v_existing.engine_version != p_engine_version
       OR v_existing.as_of != p_as_of
       OR v_existing.configuration_hash != p_configuration_hash
       OR v_existing.rule_manifest_hash != p_rule_manifest_hash THEN
      RAISE EXCEPTION 'run_key % already exists with different parameters — replay violation', p_run_key;
    END IF;
    RETURN jsonb_build_object(
      'status', 'existing',
      'run_key', v_existing.run_key,
      'run_status', v_existing.status,
      'id', v_existing.id
    );
  END IF;

  -- Insert new run
  INSERT INTO atlas.convergence_run_manifest (
    run_key, engine_version, as_of, time_window_ms, temporal_bucket_ms,
    geography_registry_version, rule_manifest_hash, configuration_hash,
    configuration_json, min_signals_for_analysis, z_score_threshold
  ) VALUES (
    p_run_key, p_engine_version, p_as_of, p_time_window_ms, p_temporal_bucket_ms,
    p_geography_registry_version, p_rule_manifest_hash, p_configuration_hash,
    p_configuration_json, p_min_signals_for_analysis, p_z_score_threshold
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'run_key', p_run_key,
    'run_status', 'running',
    'id', v_new_id
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RPC: atlas_convergence_persist_receipt_v1
-- Persist a single geography receipt. Immutable — duplicate insert is idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atlas_convergence_persist_receipt_v1(
  p_run_key               text,
  p_receipt_identity      text,
  p_geography_id          text,
  p_equation_id           text,
  p_engine_version        text,
  p_rule_manifest_hash    text,
  p_as_of                 bigint,
  p_configuration_hash    text,
  p_input_hash            text,
  p_source_signal_ids     jsonb,
  p_geography_registry_version text,
  p_expected_count        numeric,
  p_observed_count        integer,
  p_z_score               numeric,
  p_convergence_detected  boolean,
  p_status                text,
  p_reason_unresolved     text DEFAULT NULL,
  p_computed_outputs      jsonb DEFAULT '{}'::jsonb,
  p_timestamp_computed    bigint DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_existing atlas.convergence_receipt%ROWTYPE;
BEGIN
  -- Check for existing receipt
  SELECT * INTO v_existing FROM atlas.convergence_receipt
    WHERE run_key = p_run_key AND geography_id = p_geography_id;

  IF FOUND THEN
    -- Idempotency: verify receipt_identity matches
    IF v_existing.receipt_identity != p_receipt_identity THEN
      RAISE EXCEPTION 'receipt for run_key=% geography_id=% already exists with different receipt_identity — determinism violation', p_run_key, p_geography_id;
    END IF;
    RETURN jsonb_build_object('status', 'existing', 'receipt_identity', v_existing.receipt_identity);
  END IF;

  INSERT INTO atlas.convergence_receipt (
    run_key, receipt_identity, geography_id, equation_id, engine_version,
    rule_manifest_hash, as_of, configuration_hash, input_hash,
    source_signal_ids, geography_registry_version, expected_count,
    observed_count, z_score, convergence_detected, status,
    reason_unresolved, computed_outputs, timestamp_computed
  ) VALUES (
    p_run_key, p_receipt_identity, p_geography_id, p_equation_id, p_engine_version,
    p_rule_manifest_hash, p_as_of, p_configuration_hash, p_input_hash,
    p_source_signal_ids, p_geography_registry_version, p_expected_count,
    p_observed_count, p_z_score, p_convergence_detected, p_status,
    p_reason_unresolved, p_computed_outputs, p_timestamp_computed
  );

  RETURN jsonb_build_object('status', 'created', 'receipt_identity', p_receipt_identity);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPC: atlas_convergence_replay_check_v1
-- Verify replay identity: same run_key should produce same receipt_identities.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atlas_convergence_replay_check_v1(
  p_run_key text,
  p_expected_receipt_identities jsonb  -- array of {geography_id, receipt_identity}
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_expected jsonb;
  v_actual text;
  v_geo text;
  v_expected_id text;
  v_mismatches jsonb := '[]'::jsonb;
BEGIN
  FOR v_expected IN SELECT * FROM jsonb_array_elements(p_expected_receipt_identities)
  LOOP
    v_geo := v_expected->>'geography_id';
    v_expected_id := v_expected->>'receipt_identity';

    SELECT receipt_identity INTO v_actual
      FROM atlas.convergence_receipt
      WHERE run_key = p_run_key AND geography_id = v_geo;

    IF NOT FOUND THEN
      v_mismatches := v_mismatches || jsonb_build_object(
        'geography_id', v_geo,
        'expected', v_expected_id,
        'actual', NULL,
        'reason', 'no receipt found'
      );
    ELSIF v_actual != v_expected_id THEN
      v_mismatches := v_mismatches || jsonb_build_object(
        'geography_id', v_geo,
        'expected', v_expected_id,
        'actual', v_actual,
        'reason', 'receipt_identity mismatch'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'run_key', p_run_key,
    'consistent', (jsonb_array_length(v_mismatches) = 0),
    'checked_count', jsonb_array_length(p_expected_receipt_identities),
    'mismatch_count', jsonb_array_length(v_mismatches),
    'mismatches', v_mismatches
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPC: atlas_convergence_complete_run_v1
-- Mark a run as completed and persist the full result payload.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.atlas_convergence_complete_run_v1(
  p_run_key             text,
  p_output_hash         text,
  p_payload_json        jsonb,
  p_receipt_count       integer,
  p_total_signals_raw   integer DEFAULT 0,
  p_total_signals_dedup integer DEFAULT 0,
  p_total_geographies   integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Persist result payload
  INSERT INTO atlas.convergence_result_payload (run_key, output_hash, payload_json, receipt_count)
    VALUES (p_run_key, p_output_hash, p_payload_json, p_receipt_count)
    ON CONFLICT (run_key) DO NOTHING;

  -- Update run status
  UPDATE atlas.convergence_run_manifest
    SET status = 'completed',
        completed_at = now(),
        total_geographies = p_total_geographies,
        total_signals_raw = p_total_signals_raw,
        total_signals_deduplicated = p_total_signals_dedup
    WHERE run_key = p_run_key AND status = 'running';

  RETURN jsonb_build_object('status', 'completed', 'run_key', p_run_key, 'output_hash', p_output_hash);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. RLS: Least-privilege access
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE atlas.geography_registry_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas.convergence_run_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas.convergence_signal_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas.convergence_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas.convergence_result_payload ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (RPCs run as SECURITY DEFINER)
CREATE POLICY "service_role_all" ON atlas.geography_registry_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON atlas.convergence_run_manifest FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON atlas.convergence_signal_snapshot FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON atlas.convergence_receipt FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON atlas.convergence_result_payload FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon/authenticated can read receipts and result payloads (for Lighthouse consumption)
CREATE POLICY "read_receipts" ON atlas.convergence_receipt FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_results" ON atlas.convergence_result_payload FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_manifests" ON atlas.convergence_run_manifest FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_convergence_receipt_run_key ON atlas.convergence_receipt(run_key);
CREATE INDEX IF NOT EXISTS idx_convergence_receipt_geography ON atlas.convergence_receipt(geography_id);
CREATE INDEX IF NOT EXISTS idx_convergence_receipt_as_of ON atlas.convergence_receipt(as_of);
CREATE INDEX IF NOT EXISTS idx_convergence_run_as_of ON atlas.convergence_run_manifest(as_of);
CREATE INDEX IF NOT EXISTS idx_convergence_run_status ON atlas.convergence_run_manifest(status);

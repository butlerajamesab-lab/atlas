-- ============================================================
-- recognition_atlas_schema.sql
-- Luminari Atlas Platform | Recognition Atlas Module
-- Identifies entities, behavioral patterns, and actor profiles
-- across civic data streams for anomaly and corruption detection
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENTITY REGISTRY
-- Core registry of recognized actors (individuals, orgs, agencies)
-- ============================================================
CREATE TABLE IF NOT EXISTS recognized_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type VARCHAR(64) NOT NULL CHECK (entity_type IN (
    'individual', 'organization', 'agency', 'court', 'vendor',
    'contractor', 'nonprofit', 'political_actor', 'unknown'
  )),
  canonical_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  jurisdiction VARCHAR(128),
  state_code CHAR(2),
  county VARCHAR(128),
  entity_metadata JSONB DEFAULT '{}',
  risk_score NUMERIC(5,4) DEFAULT 0.0000 CHECK (risk_score BETWEEN 0 AND 1),
  confidence_score NUMERIC(5,4) DEFAULT 0.0000 CHECK (confidence_score BETWEEN 0 AND 1),
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  source_stream_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognized_entities_type ON recognized_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_recognized_entities_jurisdiction ON recognized_entities(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_recognized_entities_risk ON recognized_entities(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_recognized_entities_flagged ON recognized_entities(is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_recognized_entities_name_trgm ON recognized_entities USING gin(canonical_name gin_trgm_ops);

-- ============================================================
-- RECOGNITION PATTERNS
-- Defined behavioral or structural patterns used for matching
-- ============================================================
CREATE TABLE IF NOT EXISTS recognition_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_name VARCHAR(256) NOT NULL UNIQUE,
  pattern_category VARCHAR(64) NOT NULL CHECK (pattern_category IN (
    'financial_anomaly', 'contract_irregularity', 'behavioral',
    'network_clustering', 'timeline_deviation', 'document_fraud',
    'identity_mismatch', 'institutional_failure', 'retaliation',
    'neglect_indicator', 'abuse_indicator', 'jurisdictional_conflict'
  )),
  description TEXT,
  detection_logic JSONB NOT NULL DEFAULT '{}',
  threshold_config JSONB DEFAULT '{}',
  severity VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (severity IN (
    'low', 'medium', 'high', 'critical'
  )),
  is_active BOOLEAN DEFAULT TRUE,
  version INTEGER DEFAULT 1,
  created_by VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognition_patterns_category ON recognition_patterns(pattern_category);
CREATE INDEX IF NOT EXISTS idx_recognition_patterns_severity ON recognition_patterns(severity);
CREATE INDEX IF NOT EXISTS idx_recognition_patterns_active ON recognition_patterns(is_active) WHERE is_active = TRUE;

-- ============================================================
-- RECOGNITION EVENTS
-- Each time a pattern is matched against ingested data
-- ============================================================
CREATE TABLE IF NOT EXISTS recognition_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stream_record_id UUID,
  pattern_id UUID NOT NULL REFERENCES recognition_patterns(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES recognized_entities(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  match_score NUMERIC(5,4) NOT NULL DEFAULT 0.0000 CHECK (match_score BETWEEN 0 AND 1),
  match_details JSONB DEFAULT '{}',
  raw_evidence JSONB DEFAULT '{}',
  status VARCHAR(32) DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'dismissed', 'escalated', 'under_review'
  )),
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  investigation_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognition_events_pattern ON recognition_events(pattern_id);
CREATE INDEX IF NOT EXISTS idx_recognition_events_entity ON recognition_events(entity_id);
CREATE INDEX IF NOT EXISTS idx_recognition_events_status ON recognition_events(status);
CREATE INDEX IF NOT EXISTS idx_recognition_events_matched_at ON recognition_events(matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_recognition_events_score ON recognition_events(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_recognition_events_investigation ON recognition_events(investigation_id);

-- ============================================================
-- ENTITY RELATIONSHIPS
-- Maps known connections between recognized entities
-- ============================================================
CREATE TABLE IF NOT EXISTS entity_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id_a UUID NOT NULL REFERENCES recognized_entities(id) ON DELETE CASCADE,
  entity_id_b UUID NOT NULL REFERENCES recognized_entities(id) ON DELETE CASCADE,
  relationship_type VARCHAR(64) NOT NULL CHECK (relationship_type IN (
    'employs', 'contracts_with', 'funds', 'oversees', 'litigates_against',
    'co_defendant', 'co_plaintiff', 'affiliated', 'subsidiary',
    'board_member', 'family', 'known_associate', 'adversarial'
  )),
  relationship_metadata JSONB DEFAULT '{}',
  confidence_score NUMERIC(5,4) DEFAULT 0.5000,
  date_established DATE,
  date_dissolved DATE,
  is_active BOOLEAN DEFAULT TRUE,
  source_evidence JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (entity_id_a <> entity_id_b)
);

CREATE INDEX IF NOT EXISTS idx_entity_relationships_a ON entity_relationships(entity_id_a);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_b ON entity_relationships(entity_id_b);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_type ON entity_relationships(relationship_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_relationships_unique
  ON entity_relationships(entity_id_a, entity_id_b, relationship_type);

-- ============================================================
-- ACTOR PROFILES
-- Aggregated behavioral profile built from recognition events
-- ============================================================
CREATE TABLE IF NOT EXISTS actor_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID NOT NULL UNIQUE REFERENCES recognized_entities(id) ON DELETE CASCADE,
  total_event_count INTEGER DEFAULT 0,
  confirmed_event_count INTEGER DEFAULT 0,
  dismissed_event_count INTEGER DEFAULT 0,
  escalated_event_count INTEGER DEFAULT 0,
  pattern_categories_triggered TEXT[] DEFAULT '{}',
  highest_severity VARCHAR(16) DEFAULT 'low',
  aggregate_risk_score NUMERIC(5,4) DEFAULT 0.0000,
  network_centrality_score NUMERIC(5,4) DEFAULT 0.0000,
  behavioral_flags JSONB DEFAULT '{}',
  timeline_summary JSONB DEFAULT '{}',
  jurisdictions_active TEXT[] DEFAULT '{}',
  last_event_at TIMESTAMPTZ,
  profile_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actor_profiles_entity ON actor_profiles(entity_id);
CREATE INDEX IF NOT EXISTS idx_actor_profiles_risk ON actor_profiles(aggregate_risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_actor_profiles_severity ON actor_profiles(highest_severity);

-- ============================================================
-- RECOGNITION ATLAS RUNS
-- Tracks scheduled or triggered full-scan recognition jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS recognition_atlas_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type VARCHAR(32) DEFAULT 'scheduled' CHECK (run_type IN (
    'scheduled', 'triggered', 'manual', 'incremental'
  )),
  status VARCHAR(32) DEFAULT 'running' CHECK (status IN (
    'running', 'completed', 'failed', 'partial'
  )),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  records_scanned INTEGER DEFAULT 0,
  events_generated INTEGER DEFAULT 0,
  entities_updated INTEGER DEFAULT 0,
  patterns_evaluated INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  run_metadata JSONB DEFAULT '{}',
  triggered_by VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_atlas_runs_status ON recognition_atlas_runs(status);
CREATE INDEX IF NOT EXISTS idx_atlas_runs_started ON recognition_atlas_runs(started_at DESC);

-- ============================================================
-- WATCHLIST
-- High-priority entities under active monitoring
-- ============================================================
CREATE TABLE IF NOT EXISTS recognition_watchlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_id UUID NOT NULL UNIQUE REFERENCES recognized_entities(id) ON DELETE CASCADE,
  added_by VARCHAR(128),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT NOT NULL,
  priority VARCHAR(16) DEFAULT 'medium' CHECK (priority IN (
    'low', 'medium', 'high', 'critical'
  )),
  alert_on_match BOOLEAN DEFAULT TRUE,
  notify_channels TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchlist_entity ON recognition_watchlist(entity_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_priority ON recognition_watchlist(priority);
CREATE INDEX IF NOT EXISTS idx_watchlist_active ON recognition_watchlist(is_active) WHERE is_active = TRUE;

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recognized_entities_updated
  BEFORE UPDATE ON recognized_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_recognition_patterns_updated
  BEFORE UPDATE ON recognition_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_recognition_events_updated
  BEFORE UPDATE ON recognition_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_entity_relationships_updated
  BEFORE UPDATE ON entity_relationships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_actor_profiles_updated
  BEFORE UPDATE ON actor_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ACTOR PROFILE AUTO-UPSERT ON EVENT INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_actor_profile_on_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.entity_id IS NOT NULL THEN
    INSERT INTO actor_profiles (entity_id, total_event_count, last_event_at)
    VALUES (NEW.entity_id, 1, NEW.matched_at)
    ON CONFLICT (entity_id) DO UPDATE SET
      total_event_count = actor_profiles.total_event_count + 1,
      last_event_at = GREATEST(actor_profiles.last_event_at, NEW.matched_at),
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_actor_profile_on_event
  AFTER INSERT ON recognition_events
  FOR EACH ROW EXECUTE FUNCTION upsert_actor_profile_on_event();

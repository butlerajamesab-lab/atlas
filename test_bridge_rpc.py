#!/usr/bin/env python3
"""Test the bridge RPC function against live Atlas Supabase."""
import requests
import json

MGMT_PAT = "sbp_b263c14918e796c9850c43a6588663a33dc16dc2"
REF = "bjdjjgnkhxblnpdrjqtw"

def run_sql(sql):
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        headers={
            "Authorization": f"Bearer {MGMT_PAT}",
            "Content-Type": "application/json",
        },
        json={"query": sql}
    )
    return r.json()

# Test 1: Verify the function exists
print("=== Test 1: Function exists ===")
result = run_sql("""
SELECT routine_name, routine_schema 
FROM information_schema.routines 
WHERE routine_name = 'trigger_lighthouse_bridge_for_prime_pattern_v1';
""")
print(json.dumps(result, indent=2)[:300])

# Test 2: Call the function with inline JSON
print("\n=== Test 2: Call bridge RPC ===")
result = run_sql("""
SELECT public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  '{"source_record_id": "test-pattern-002", "signal_type": "eeoc_complaint_cluster", "geography_key": "us-wa", "confidence_score": "0.85", "generation_method": "deterministic_rule", "source_url": "https://www.eeoc.gov/data", "severity": "medium", "signal_status": "active", "rule_id": "cluster_detection_v1", "rule_version": "v1", "record_origin": "streaming_investigation"}'::jsonb,
  '{"bridge_id": "atlas-to-lighthouse"}'::jsonb,
  false
) AS result;
""")
print(json.dumps(result, indent=2)[:800])

# Test 3: Check if signal landed in civic_map_signals
print("\n=== Test 3: Check civic_map_signals ===")
result = run_sql("""
SELECT signal_id, signal_type, geography_key, confidence_score, source_url, rule_id
FROM atlas.civic_map_signals
WHERE source_record_id = 'test-pattern-002'
LIMIT 1;
""")
print(json.dumps(result, indent=2)[:500])

# Test 4: Check bridge_sync_log
print("\n=== Test 4: Check bridge_sync_log ===")
result = run_sql("""
SELECT log_id, bridge_id, sync_type, source_record_id, status
FROM atlas.bridge_sync_log
WHERE source_record_id = 'test-pattern-002'
ORDER BY synced_at DESC
LIMIT 1;
""")
print(json.dumps(result, indent=2)[:500])

# Test 5: Dedup test - call again with same source_record_id
print("\n=== Test 5: Dedup (should skip) ===")
result = run_sql("""
SELECT public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  '{"source_record_id": "test-pattern-002", "signal_type": "eeoc_complaint_cluster", "geography_key": "us-wa", "confidence_score": "0.85", "generation_method": "deterministic_rule", "source_url": "https://www.eeoc.gov/data", "severity": "medium", "signal_status": "active", "rule_id": "cluster_detection_v1", "rule_version": "v1", "record_origin": "streaming_investigation"}'::jsonb,
  '{"bridge_id": "atlas-to-lighthouse"}'::jsonb,
  false
) AS result;
""")
print(json.dumps(result, indent=2)[:500])

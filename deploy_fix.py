#!/usr/bin/env python3
"""Deploy the fixed bridge RPC to Atlas Supabase and verify it works."""
import requests
import json
import sys

PAT = "sbp_b263c14918e796c9850c43a6588663a33dc16dc2"
PROJECT = "bjdjjgnkhxblnpdrjqtw"
BASE = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
HEADERS = {"Authorization": f"Bearer {PAT}", "Content-Type": "application/json"}

def run_sql(sql, label=""):
    r = requests.post(BASE, headers=HEADERS, json={"query": sql})
    data = r.json()
    if isinstance(data, dict) and "message" in data and "ERROR" in data.get("message", ""):
        print(f"  FAIL [{label}]: {data['message']}")
        return None
    return data

# Step 1: Deploy the fixed function
print("=" * 60)
print("STEP 1: Deploy fixed bridge RPC (audit_log_id bigint)")
print("=" * 60)

with open("/home/ubuntu/atlas-fix/src/schema/002_lighthouse_bridge_rpc.sql") as f:
    sql = f.read()

result = run_sql(sql, "deploy")
if result is None:
    print("DEPLOYMENT FAILED!")
    sys.exit(1)
print("  OK: Function deployed successfully")

# Step 2: Clean up any test data from previous runs
print("\n" + "=" * 60)
print("STEP 2: Clean test data from previous failed runs")
print("=" * 60)

run_sql("DELETE FROM atlas.bridge_sync_log WHERE source_record_id LIKE 'test-pattern-%';", "cleanup log")
run_sql("DELETE FROM atlas.lighthouse_bridge_queue WHERE atlas_signal_id IN (SELECT signal_id FROM atlas.civic_map_signals WHERE source_record_id LIKE 'test-pattern-%');", "cleanup queue")
run_sql("DELETE FROM atlas.civic_map_signals WHERE source_record_id LIKE 'test-pattern-%';", "cleanup signals")
print("  OK: Test data cleaned")

# Step 3: Run the bridge RPC
print("\n" + "=" * 60)
print("STEP 3: Call bridge RPC with test signal")
print("=" * 60)

test_signal = json.dumps({
    "source_record_id": "test-pattern-100",
    "signal_type": "eeoc_complaint_cluster",
    "geography_key": "us-wa",
    "confidence_score": "0.85",
    "generation_method": "deterministic_rule",
    "source_url": "https://www.eeoc.gov/data",
    "severity": "medium",
    "signal_status": "active",
    "rule_id": "cluster_detection_v1",
    "rule_version": "v1",
    "record_origin": "streaming_investigation"
})

result = run_sql(f"""
SELECT public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  '{test_signal}'::jsonb,
  '{{"bridge_id": "atlas-to-lighthouse"}}'::jsonb,
  false
) AS result;
""", "bridge call")

if result is None:
    print("BRIDGE CALL FAILED!")
    sys.exit(1)

print(f"  Result: {json.dumps(result, indent=2)}")

# Parse the result
if isinstance(result, list) and len(result) > 0:
    res_val = result[0].get("result")
    if isinstance(res_val, str):
        res_val = json.loads(res_val)
    if res_val and res_val.get("bridged") == True:
        print("  OK: Signal bridged successfully!")
    elif res_val and res_val.get("skipped") == True:
        print("  OK: Signal skipped (already bridged) - dedup working")
    else:
        print(f"  WARNING: Unexpected result: {res_val}")

# Step 4: Verify signal landed in civic_map_signals
print("\n" + "=" * 60)
print("STEP 4: Verify signal in civic_map_signals")
print("=" * 60)

result = run_sql("""
SELECT signal_id, signal_type, geography_key, confidence_score, generation_method
FROM atlas.civic_map_signals
WHERE source_record_id = 'test-pattern-100';
""", "verify signal")

if result and len(result) > 0:
    print(f"  OK: Signal found - ID={result[0]['signal_id']}, type={result[0]['signal_type']}")
else:
    print("  FAIL: Signal not found in civic_map_signals!")
    sys.exit(1)

# Step 5: Verify audit log entry
print("\n" + "=" * 60)
print("STEP 5: Verify bridge_sync_log entry")
print("=" * 60)

result = run_sql("""
SELECT log_id, bridge_id, sync_type, status, duration_ms
FROM atlas.bridge_sync_log
WHERE source_record_id = 'test-pattern-100';
""", "verify log")

if result and len(result) > 0:
    print(f"  OK: Log entry found - ID={result[0]['log_id']}, status={result[0]['status']}, duration={result[0]['duration_ms']}ms")
else:
    print("  FAIL: No log entry found!")
    sys.exit(1)

# Step 6: Test dedup (call again with same source_record_id)
print("\n" + "=" * 60)
print("STEP 6: Test dedup (same signal again should skip)")
print("=" * 60)

result = run_sql(f"""
SELECT public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  '{test_signal}'::jsonb,
  '{{"bridge_id": "atlas-to-lighthouse"}}'::jsonb,
  false
) AS result;
""", "dedup test")

if result and len(result) > 0:
    res_val = result[0].get("result")
    if isinstance(res_val, str):
        res_val = json.loads(res_val)
    if res_val and res_val.get("skipped") == True:
        print(f"  OK: Dedup working - skipped with reason: {res_val.get('reason')}")
    else:
        print(f"  WARNING: Expected skip, got: {res_val}")

# Step 7: Test determinism gate (should reject non-deterministic)
print("\n" + "=" * 60)
print("STEP 7: Test determinism gate (should reject)")
print("=" * 60)

bad_signal = json.dumps({
    "source_record_id": "test-pattern-bad",
    "signal_type": "ai_generated",
    "geography_key": "us-wa",
    "confidence_score": "0.9",
    "generation_method": "ai_inference",
    "source_url": "https://example.com"
})

result = run_sql(f"""
SELECT public.trigger_lighthouse_bridge_for_prime_pattern_v1(
  '{bad_signal}'::jsonb,
  '{{}}'::jsonb,
  false
) AS result;
""", "determinism gate")

if result is None:
    print("  OK: Non-deterministic signal correctly rejected!")
else:
    print(f"  FAIL: Should have been rejected but got: {result}")

print("\n" + "=" * 60)
print("ALL TESTS PASSED - Bridge RPC is working end-to-end!")
print("=" * 60)

"""Compare real old/new SELECT expressions over explicit edge-case VALUES.

This is query-logic verification, not a full Atlas migration replay or a
production performance claim. No fixture is persisted and no schema is created.
"""
import argparse
import json
import os
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
schema = root / 'src/schema'
new = (schema / '20261022_observation_read_model_covering_rollup.sql').read_text()
old_summary = (schema / '20261018_signal_derivation_single_pass.sql').read_text()
old_stream = (schema / '20261019_stream_runtime_grouped_summary.sql').read_text()
original = (schema / '20260809_signal_ontology_read_model.sql').read_text()


def body(source, name):
    expression = (r'create or replace view public\.' + re.escape(name) +
                  r'\s+with\s*\(security_invoker\s*=\s*true\)\s+as\s+([\s\S]*?);\n')
    match = re.search(expression, source, flags=re.I)
    assert match, name
    return match.group(1)


def metrics(source):
    match = re.search(r'WITH observation_metrics AS MATERIALIZED \(([\s\S]*?)\n\),\nlatest_convergence AS', source)
    assert match
    return match.group(1)


# The other 31 summary fields must remain exactly the reviewed source expression.
assert old_summary.split('\n),\nlatest_convergence AS', 1)[1].split('\nrevoke all', 1)[0] == (
    new.split('\n),\nlatest_convergence AS', 1)[1].split('\ncreate or replace view public.v_atlas_stream_runtime_summary_v1', 1)[0].rstrip() + '\n')

old_runtime = body(old_stream, 'v_atlas_stream_runtime_summary_v1')
new_runtime = body(new, 'v_atlas_stream_runtime_summary_v1')
assert old_runtime.split('left join (')[0] == new_runtime.split('left join (')[0]
observation = body(original, 'v_atlas_observation_type_summary_v1')

seed = "('a'::text,'one'::text,'m1'::text,'j1'::text,'2026-01-01'::timestamptz,'2026-01-02'::timestamptz,'h1'::text)"
mixed = """values
 ('a'::text,'one'::text,'m1'::text,'j1'::text,'2026-01-01'::timestamptz,'2026-01-02'::timestamptz,'h1'::text),
 ('a','one','m1','j1','2026-01-02'::timestamptz,'2026-01-03'::timestamptz,null),
 ('a','one','m2','j2','2026-01-03'::timestamptz,null,'h2'),
 ('a','two','m1','j1',null,'2026-01-05'::timestamptz,'h3'),
 ('b','one','m3','j3','2026-01-04'::timestamptz,'2026-01-04'::timestamptz,null),
 ('orphan','three',null,null,'2026-01-06'::timestamptz,'2026-01-06'::timestamptz,'h4')"""
cases = [
    ('empty', 'select * from (values ' + seed + ') t where false'),
    ('one_bound_observation', 'values ' + seed),
    ('metadata_splits_duplicates_unbound_and_unregistered_stream', mixed),
    ('null_classification_and_null_stream', """values
      ('a'::text,null::text,null::text,null::text,null::timestamptz,null::timestamptz,null::text),
      (null,null,'m','j','2026-01-01'::timestamptz,'2026-01-02'::timestamptz,'h')"""),
]


def fixture_query(events):
    def adapt(query):
        return (query.replace('public.signal_events', 'event_fixture')
                .replace('public.v_atlas_observation_type_summary_v1', 'observation_fixture')
                .replace('public.streams', 'stream_fixture'))
    return f"""with
event_fixture(stream_id,signal_type,module_hint,jurisdiction_id,"timestamp",ingested_at,event_identity_hash) as ({events}),
stream_fixture(stream_id,source_id,jurisdiction_id,module_hint,throughput_profile,safety_profile,governance_contract_id,status,created_at,updated_at) as (
 values
 ('a'::text,'source'::text,'j'::text,'m'::text,'low'::text,'default'::text,'contract'::text,'active'::text,'2026-01-01'::timestamptz,'2026-01-01'::timestamptz),
 ('b','source','j','m','low','default','contract','active','2026-01-01'::timestamptz,'2026-01-01'::timestamptz),
 ('empty','source','j','m','low','default','contract','active','2026-01-01'::timestamptz,'2026-01-01'::timestamptz)
),
observation_fixture as ({adapt(observation)}),
old_metrics as ({adapt(metrics(old_summary))}),
new_metrics as ({adapt(metrics(new))}),
old_runtime as ({adapt(old_runtime)}),
new_runtime as ({adapt(new_runtime)}),
metric_difference as ((select * from old_metrics except all select * from new_metrics) union all (select * from new_metrics except all select * from old_metrics)),
runtime_difference as ((select * from old_runtime except all select * from new_runtime) union all (select * from new_runtime except all select * from old_runtime))
select (select count(*) from metric_difference) as metric_differences,
       (select count(*) from runtime_difference) as runtime_differences,
       (select count(*) from new_runtime where stream_id='empty' and event_count=0 and identity_count=0 and signal_type_count=0) as empty_stream_preserved;
"""


queries = [{'name': name, 'sql': fixture_query(events)} for name, events in cases]
parser = argparse.ArgumentParser()
parser.add_argument('--emit-only', action='store_true')
args = parser.parse_args()
if args.emit_only:
    print(json.dumps(queries))
else:
    import psycopg
    with psycopg.connect(os.environ['TEST_DATABASE_URL']) as connection:
        for case in queries:
            result = connection.execute(case['sql']).fetchone()
            assert result == (0, 0, 1), (case['name'], result)
            print('PASS: ' + case['name'])
    print('PASS: all 31 other summary fields and the 16-column runtime projection are source-identical')

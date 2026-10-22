"""Run only against a fresh disposable PostgreSQL database, never production.

Reproduce the review defect with the original view, apply the actual guarded
forward migration, compare every output column, and exercise its exact rollback.
The registry stubs contain only the columns used by this existing view; this is
a focused migration proof, not a claim of full Atlas schema replay.
"""

import os
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "src/schema"
VIEW = "public.v_atlas_source_operational_readiness_v1"
FORWARD = SCHEMA / "20261022_source_health_receipt_correction_order.sql"
ROLLBACK = SCHEMA / "rollback/20261022_source_health_receipt_correction_order.sql"


def connector(number):
    return UUID(f"10000000-0000-0000-0000-{number:012d}")


def rows(db):
    return db.execute(f"select * from {VIEW} order by connector_id").fetchall()


def metadata(db):
    return db.execute(
        """select relowner, relacl::text, reloptions,
          (select array_agg((attname,atttypid,atttypmod)::text order by attnum)
           from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped) as columns
          from pg_class c where c.oid=%s::regclass""", (VIEW,)
    ).fetchone()


with psycopg.connect(os.environ["TEST_DATABASE_URL"], autocommit=True, row_factory=dict_row) as db:
    db.execute("""
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.schema_registry (
        id uuid primary key, name text, version text, active boolean);
      create table public.connector_registry (
        id uuid primary key, name text, adapter_class text, active boolean,
        last_run_at timestamptz, next_run_at timestamptz,
        schema_id uuid references public.schema_registry(id));
      create table public.ingest_jobs (
        id uuid primary key, connector_id uuid, status text,
        started_at timestamptz, completed_at timestamptz,
        records_fetched integer, records_inserted integer, records_updated integer,
        records_failed integer, records_deduplicated integer);
    """)
    db.execute((SCHEMA / "20260806_source_health_receipts.sql").read_text())
    schema_id = UUID("20000000-0000-0000-0000-000000000001")
    db.execute("insert into schema_registry values (%s,'fixture','1',true)", (schema_id,))
    for number in range(1, 7):
        db.execute(
            "insert into connector_registry(id,name,adapter_class,active,schema_id) "
            "values (%s,%s,'fixture',%s,%s)",
            (connector(number), f"fixture-{number}", number != 5, schema_id),
        )

    def receipt(event_id, number, observed, created, status, hash_character,
                freshness="unknown", schema_status="unknown"):
        db.execute(
            """insert into atlas_source_health_event
              (health_event_id,connector_id,schema_id,observed_at,created_at,health_status,
               freshness_status,schema_status,source_state_hash,records_observed)
              values (%s,%s,%s,%s,%s,%s,%s,%s,%s,10)""",
            (UUID(event_id), connector(number), schema_id, observed, created, status,
             freshness, schema_status, hash_character * 64),
        )

    # Deliberately assign the obsolete receipt the larger random UUID.
    receipt("ffffffff-ffff-ffff-ffff-ffffffffffff", 1,
            "2026-08-06T10:00:00Z", "2026-08-06T10:00:01Z", "unknown", "a")
    correction_id = UUID("00000000-0000-0000-0000-000000000001")
    receipt(str(correction_id), 1,
            "2026-08-06T10:00:00Z", "2026-10-22T10:00:00Z", "degraded", "b")
    # Later insertion must not override a genuinely newer observation.
    receipt("00000000-0000-0000-0000-000000000002", 2,
            "2026-08-07T10:00:00Z", "2026-08-07T10:00:01Z", "failing", "c")
    receipt("00000000-0000-0000-0000-000000000003", 2,
            "2026-08-06T10:00:00Z", "2026-10-22T10:00:00Z", "healthy", "d", "fresh", "stable")
    # UUID remains a deterministic final tie-break when both timestamps tie.
    receipt("00000000-0000-0000-0000-000000000004", 3,
            "2026-08-06T10:00:00Z", "2026-08-06T10:00:01Z", "healthy", "e")
    receipt("00000000-0000-0000-0000-000000000005", 3,
            "2026-08-06T10:00:00Z", "2026-08-06T10:00:01Z", "degraded", "f")
    # No receipt for connector 4. Inactive connector 5 must stay not_active.
    receipt("00000000-0000-0000-0000-000000000006", 5,
            "2026-08-06T10:00:00Z", "2026-08-06T10:00:01Z", "healthy", "1", "fresh", "stable")
    receipt("00000000-0000-0000-0000-000000000007", 6,
            "2026-08-06T10:00:00Z", "2026-08-06T10:00:01Z", "healthy", "2", "fresh", "stable")
    db.execute(
        "insert into atlas_source_fallback_binding(connector_id,fallback_connector_id,"
        "fallback_priority,fallback_reason) values (%s,%s,1,'fixture')",
        (connector(1), connector(6)),
    )
    db.execute(
        """insert into ingest_jobs values
        ('30000000-0000-0000-0000-000000000001',%s,'partial',
         '2026-08-06T09:00:00Z','2026-08-06T10:00:00Z',10,6,1,2,1)""", (connector(1),)
    )
    before, before_metadata = rows(db), metadata(db)
    assert before[0]["health_status"] == "unknown", "Original defect was not reproduced"
    expected = [dict(row) for row in before]
    expected[0].update(health_event_id=correction_id, health_status="degraded", source_state_hash="b" * 64)

    db.execute(FORWARD.read_text())
    after = rows(db)
    assert after == expected, "Unexpected change in complete readiness outputs"
    assert metadata(db) == before_metadata, "Owner, grants, invoker security or columns changed"
    assert after[1]["health_status"] == "failing" and after[1]["operational_readiness_state"] == "blocked"
    assert after[2]["health_event_id"] == UUID("00000000-0000-0000-0000-000000000005")
    assert after[3]["operational_readiness_state"] == "unknown"
    assert after[4]["operational_readiness_state"] == "not_active"
    assert after[5]["operational_readiness_state"] == "ready"
    assert after[0]["freshness_status"] == "unknown" and after[0]["schema_status"] == "unknown"
    assert db.execute("select count(*) as n from atlas_source_health_event").fetchone()["n"] == 8
    for role in ("anon", "authenticated"):
        assert not db.execute("select has_table_privilege(%s,%s,'SELECT') as allowed", (role, VIEW)).fetchone()["allowed"]
    print("PASS: original UUID defect reproduced; six readiness scenarios and all output columns verified")
    print(db.execute("select md5(pg_get_viewdef(%s::regclass,true)) as installed_view_md5", (VIEW,)).fetchone())

    db.execute(ROLLBACK.read_text())
    assert rows(db) == before and metadata(db) == before_metadata
    print("PASS: guarded rollback restores the exact original outputs and access boundary")

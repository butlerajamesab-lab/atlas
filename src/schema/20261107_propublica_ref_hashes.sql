-- 2026-11-07 correction (RULE-AUDIT-2026-11-07): ProPublica unresolved-
-- metadata candidates carried source_event_refs with no
-- event_identity_hash (115 of 115 null in production) while every
-- other candidate family hash-chains its evidence. The view already
-- holds each representative event's hash in its canonical_events CTE;
-- this replacement carries it into the refs. Because the view's
-- source_input_hash commits to the refs, candidate hashes change, so
-- the same file retires this rule's pre-fix current candidates whose
-- refs still lack the hash (guarded, idempotent).

create or replace view atlas.v_propublica_unresolved_metadata_candidate_v1
with (security_invoker = true)
as
with canonical_events as (
  select
    event.stream_id,
    event."offset",
    event.timestamp as source_observed_at,
    event.payload,
    event.provenance,
    identity.event_identity_hash,
    identity.source_record_key,
    lower(trim(coalesce(event.payload->>'organization_name', ''))) as normalized_entity_name,
    (
      event.payload->>'tax_period' is null
      or event.payload->>'form_type' is null
      or coalesce(event.payload->>'external_id', '') like '%-unknown'
    ) as unresolved
  from atlas.signal_event_identity identity
  join public.signal_events event
    on event.stream_id = identity.stream_id
   and event."offset" = identity.canonical_offset
  where identity.stream_id = 'pro_publica'
    and identity.signal_type = 'nonprofit_990_filing'
    and coalesce(event.payload->>'organization_name', '') <> ''
),
unique_records as (
  select
    normalized_entity_name,
    source_record_key,
    min("offset") as representative_offset,
    max(source_observed_at) as source_freshness_at,
    bool_or(unresolved) as unresolved,
    max(payload->>'organization_name') as organization_name,
    max(payload->>'pdf_url') as source_url
  from canonical_events
  group by normalized_entity_name, source_record_key
),
aggregates as (
  select
    normalized_entity_name,
    max(organization_name) as organization_name,
    count(*)::integer as unique_record_count,
    count(*) filter (where unresolved)::integer as unresolved_unique_record_count,
    round(
      count(*) filter (where unresolved)::numeric / nullif(count(*), 0),
      6
    ) as unresolved_unique_rate,
    max(source_freshness_at) as source_freshness_at
  from unique_records
  group by normalized_entity_name
),
exact_entities as (
  select
    aggregate.*,
    entity.entity_id,
    entity.entity_type,
    entity.primary_name,
    entity.last_verified,
    entity.match_count
  from aggregates aggregate
  cross join lateral (
    select
      min(registry.entity_id) as entity_id,
      min(registry.entity_type) as entity_type,
      min(registry.primary_name) as primary_name,
      max(registry.last_verified) as last_verified,
      count(*)::integer as match_count
    from atlas.entity_registry registry
    where registry.is_active
      and lower(trim(registry.primary_name)) = aggregate.normalized_entity_name
  ) entity
  where entity.match_count = 1
),
with_refs as (
  select
    exact.*,
    case
      when unresolved_unique_rate >= 0.95 and unique_record_count >= 100 then 'critical'
      when unresolved_unique_rate >= 0.80 and unique_record_count >= 10 then 'high'
      else 'medium'
    end as severity,
    (
      select jsonb_agg(
        jsonb_build_object(
          'stream_id', 'pro_publica',
          'offset', reference.representative_offset,
          'event_identity_hash', reference.event_identity_hash,
          'source_record_key', reference.source_record_key,
          'source_url', reference.source_url
        )
        order by reference.source_record_key
      )
      from (
        select
          record.source_record_key,
          record.representative_offset,
          record.source_url,
          (
            select ce.event_identity_hash
            from canonical_events ce
            where ce.source_record_key = record.source_record_key
              and ce."offset" = record.representative_offset
            order by ce.event_identity_hash
            limit 1
          ) as event_identity_hash
        from unique_records record
        where record.normalized_entity_name = exact.normalized_entity_name
        order by record.source_record_key
        limit 25
      ) reference
    ) as source_event_refs
  from exact_entities exact
)
select
  with_refs.*,
  jsonb_build_object(
    'candidate_identity_version', '1.1.0',
    'unique_source_record_count', unique_record_count,
    'unresolved_unique_record_count', unresolved_unique_record_count,
    'unresolved_unique_rate', unresolved_unique_rate,
    'identity_unit', 'unique external_id plus pdf_url',
    'source_freshness_basis', 'maximum stable source event timestamp',
    'entity_resolution_method', 'entity_registry_primary_name_exact',
    'entity_resolution_match_count', match_count,
    'entity_registry_last_verified', last_verified,
    'historical_raw_event_count', (
      select count(*)
      from public.signal_events event
      where event.stream_id = 'pro_publica'
        and event.signal_type = 'nonprofit_990_filing'
        and lower(trim(coalesce(event.payload->>'organization_name', ''))) = with_refs.normalized_entity_name
    ),
    'canonical_event_count', (
      select count(*)
      from canonical_events event
      where event.normalized_entity_name = with_refs.normalized_entity_name
    )
  ) as supporting_statistics,
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'candidate_identity_version', '1.1.0',
          'stream_id', 'pro_publica',
          'entity_id', entity_id,
          'unique_record_count', unique_record_count,
          'unresolved_unique_record_count', unresolved_unique_record_count,
          'unresolved_unique_rate', unresolved_unique_rate,
          'source_event_refs', source_event_refs,
          'entity_resolution_method', 'entity_registry_primary_name_exact'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) as source_input_hash
from with_refs;

-- One-time transition: retire pre-fix current candidates of this rule
-- whose evidence refs carry no event_identity_hash on any ref.
update atlas.live_data_signal_candidate
set is_current = false
where rule_id = 'atlas.propublica_unresolved_filing_metadata_rate'
  and is_current = true
  and jsonb_typeof(evidence_refs) = 'array'
  and jsonb_array_length(evidence_refs) > 0
  and not exists (
    select 1
    from jsonb_array_elements(evidence_refs) as ref
    where ref ? 'event_identity_hash'
  );

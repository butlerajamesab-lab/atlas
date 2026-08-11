import { supabase } from '../lib/supabaseClient.js';

export const PUBLIC_STREAM_CATALOG = [
  {
    stream_id: 'cfpb_complaints',
    source_id: 'cfpb',
    jurisdiction_id: 'us_federal',
    module_hint: 'consumer_protection',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-cfpb-complaints-v2',
    status: 'active',
    source_url: 'https://www.consumerfinance.gov/data-research/consumer-complaints/',
    api_url: 'https://api.consumerfinance.gov/data-research/consumer-complaints/search.json',
    update_frequency: 'daily',
    description: 'Nationwide consumer finance complaints published by the Consumer Financial Protection Bureau.',
    tags: ['federal', 'complaints', 'finance', 'consumer_protection', 'entity_patterns'],
  },
  {
    stream_id: 'wa_ag_consumer_complaints',
    source_id: 'wa_ag',
    jurisdiction_id: 'us_state_wa',
    module_hint: 'consumer_protection',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-wa-ag-consumer-complaints-v2',
    status: 'active',
    source_url: 'https://data.wa.gov/Consumer-Protection/Attorney-General-Consumer-Complaints/gpri-47xz',
    api_url: 'https://data.wa.gov/resource/gpri-47xz.json',
    update_frequency: 'daily',
    description: "Consumer complaints filed with the Washington State Attorney General's Office Consumer Protection Division.",
    tags: ['state', 'complaints', 'consumer_protection', 'washington', 'entity_patterns'],
  },
  {
    stream_id: 'or_doj_consumer_complaints',
    source_id: 'or_doj',
    jurisdiction_id: 'us_state_or',
    module_hint: 'consumer_protection',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-or-doj-consumer-complaints-v1',
    status: 'active',
    source_url: 'https://data.oregon.gov/Public-Safety/Oregon-Consumer-Complaints/2ix7-8hwk',
    api_url: 'https://data.oregon.gov/resource/2ix7-8hwk.json',
    update_frequency: 'daily',
    description: 'Public Oregon consumer complaint records for cross-jurisdiction consumer-protection pattern analysis.',
    tags: ['state', 'complaints', 'consumer_protection', 'oregon', 'entity_patterns'],
  },
  {
    stream_id: 'wa_pdc_documents',
    source_id: 'wa_pdc',
    jurisdiction_id: 'us_state_wa',
    module_hint: 'campaign_finance',
    throughput_profile: 'medium',
    safety_profile: 'default',
    governance_contract_id: 'atlas-wa-pdc-documents-v1',
    status: 'active',
    source_url: 'https://data.wa.gov/Politics/Public-Disclosure-Commission-Imaged-Documents/j78t-andi',
    api_url: 'https://data.wa.gov/resource/j78t-andi.json',
    update_frequency: 'daily',
    description: 'Campaign finance filings and disclosure documents from the Washington Public Disclosure Commission.',
    tags: ['state', 'campaign_finance', 'public_records', 'washington'],
  },
  {
    stream_id: 'nyc_311_service_requests',
    source_id: 'nyc_311',
    jurisdiction_id: 'us_city_nyc',
    module_hint: 'municipal_services',
    throughput_profile: 'high',
    safety_profile: 'default',
    governance_contract_id: 'atlas-nyc-311-service-requests-v2',
    status: 'active',
    source_url: 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests/erm2-nwe9',
    api_url: 'https://data.cityofnewyork.us/resource/erm2-nwe9.json',
    update_frequency: 'hourly',
    description: 'New York City 311 service requests for municipal service pressure, agency routing, actor recurrence, and neighborhood clusters.',
    tags: ['local', '311', 'municipal_services', 'new_york_city', 'entity_patterns'],
  },
  {
    stream_id: 'chicago_311_service_requests',
    source_id: 'chicago_311',
    jurisdiction_id: 'us_city_chicago',
    module_hint: 'municipal_services',
    throughput_profile: 'high',
    safety_profile: 'default',
    governance_contract_id: 'atlas-chicago-311-service-requests-v2',
    status: 'active',
    source_url: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests/v6vf-nfxy',
    api_url: 'https://data.cityofchicago.org/resource/v6vf-nfxy.json',
    update_frequency: 'hourly',
    description: 'Chicago 311 service requests for service pressure, agency routing, actor recurrence, and neighborhood clusters.',
    tags: ['local', '311', 'municipal_services', 'chicago', 'entity_patterns'],
  },
];

function countBy(key) {
  return PUBLIC_STREAM_CATALOG.reduce((acc, stream) => {
    const value = stream[key] ?? 'unknown';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

export function summarizePublicStreamCatalog() {
  return {
    total_streams: PUBLIC_STREAM_CATALOG.length,
    by_module: countBy('module_hint'),
    by_jurisdiction: countBy('jurisdiction_id'),
    streams: PUBLIC_STREAM_CATALOG,
  };
}

function toStreamRow(stream, now) {
  return {
    stream_id: stream.stream_id,
    source_id: stream.source_id,
    jurisdiction_id: stream.jurisdiction_id,
    module_hint: stream.module_hint,
    throughput_profile: stream.throughput_profile,
    safety_profile: stream.safety_profile,
    governance_contract_id: stream.governance_contract_id,
    status: stream.status,
    created_at: now,
    updated_at: now,
  };
}

export async function populatePublicStreams({ stream_ids = undefined } = {}) {
  const selected = Array.isArray(stream_ids) && stream_ids.length
    ? PUBLIC_STREAM_CATALOG.filter((stream) => stream_ids.includes(stream.stream_id))
    : PUBLIC_STREAM_CATALOG;
  const created_stream_ids = [];
  const skipped_stream_ids = [];
  const upserted_stream_ids = [];
  const now = new Date().toISOString();

  for (const stream of selected) {
    const { data: existing, error: existingError } = await supabase
      .from('streams')
      .select('stream_id,status')
      .eq('stream_id', stream.stream_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      skipped_stream_ids.push(stream.stream_id);
      continue;
    }
    const { error: upsertError } = await supabase
      .from('streams')
      .upsert(toStreamRow(stream, now), { onConflict: 'stream_id' });
    if (upsertError) throw upsertError;
    created_stream_ids.push(stream.stream_id);
    upserted_stream_ids.push(stream.stream_id);
  }

  return {
    total_selected: selected.length,
    created: created_stream_ids.length,
    skipped: skipped_stream_ids.length,
    created_stream_ids,
    skipped_stream_ids,
    upserted_stream_ids,
  };
}

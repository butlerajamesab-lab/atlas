import dotenv from 'dotenv';
import { supabase } from '../src/lib/supabaseClient.js';

dotenv.config();

const now = new Date().toISOString();
const streams = [
  {
    stream_id: 'court_listener',
    source_id: 'court_listener',
    jurisdiction_id: 'us_federal',
    module_hint: 'judicial',
    throughput_profile: 'medium',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-court-listener-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'open_states',
    source_id: 'open_states',
    jurisdiction_id: 'us_states',
    module_hint: 'legislative',
    throughput_profile: 'high',
    safety_profile: 'default',
    governance_contract_id: 'atlas-open-states-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'grants_gov',
    source_id: 'grants_gov',
    jurisdiction_id: 'us_federal',
    module_hint: 'grants',
    throughput_profile: 'medium',
    safety_profile: 'default',
    governance_contract_id: 'atlas-grants-gov-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'pro_publica',
    source_id: 'pro_publica',
    jurisdiction_id: 'us_federal',
    module_hint: 'congressional',
    throughput_profile: 'medium',
    safety_profile: 'default',
    governance_contract_id: 'atlas-pro-publica-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'cfpb_complaints',
    source_id: 'cfpb',
    jurisdiction_id: 'us_federal',
    module_hint: 'consumer_finance',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-cfpb-complaints-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'eeoc_filings',
    source_id: 'eeoc',
    jurisdiction_id: 'us_federal',
    module_hint: 'civil_rights',
    throughput_profile: 'medium',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-eeoc-filings-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'dol_whd_violations',
    source_id: 'dol_whd',
    jurisdiction_id: 'us_federal',
    module_hint: 'labor_enforcement',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-dol-whd-violations-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
  {
    stream_id: 'osha_incidents',
    source_id: 'osha',
    jurisdiction_id: 'us_federal',
    module_hint: 'workplace_safety',
    throughput_profile: 'high',
    safety_profile: 'restricted',
    governance_contract_id: 'atlas-osha-incidents-v1',
    status: 'active',
    created_at: now,
    updated_at: now,
  },
];

const { data, error } = await supabase.from('streams').upsert(streams, { onConflict: 'stream_id' }).select('*');
if (error) {
  console.error(error);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, registered: data.length, stream_ids: data.map((stream) => stream.stream_id) }, null, 2));

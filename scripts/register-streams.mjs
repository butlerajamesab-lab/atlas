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
];

const { data, error } = await supabase.from('streams').upsert(streams, { onConflict: 'stream_id' }).select('*');
if (error) {
  console.error(error);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, registered: data.length, stream_ids: data.map((stream) => stream.stream_id) }, null, 2));

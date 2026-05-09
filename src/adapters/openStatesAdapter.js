import axios from 'axios';
import dotenv from 'dotenv';
import { asArray, postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';

dotenv.config();

const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY || process.env.OPEN_STATES_API_KEY;
const OPENSTATES_API_BASE_URL = process.env.OPENSTATES_API_BASE_URL || 'https://v3.openstates.org';

function apiHeaders(apiKey = OPENSTATES_API_KEY) {
  return apiKey ? { 'X-API-KEY': apiKey, Accept: 'application/json' } : { Accept: 'application/json' };
}

function jurisdictionFromBill(bill, fallback = 'us_states') {
  return bill.jurisdiction?.id || bill.jurisdiction?.name || bill.jurisdiction || fallback;
}

export function normalizeOpenStatesBill(bill, { jurisdiction = 'us_states' } = {}) {
  const region = jurisdictionFromBill(bill, jurisdiction);
  const sourceUrl = sourceUrlFrom(bill.openstates_url, bill.openstatesUrl, bill.sources?.[0]?.url, bill.source_url);

  return {
    signal_type: 'legislative_activity',
    timestamp: toIsoTimestamp(bill.updated_at, bill.updatedAt, bill.created_at, bill.createdAt, bill.latest_action_date, bill.latestActionDate),
    spacetime: {
      region,
      jurisdiction: region,
      session: bill.session || bill.legislative_session || null,
      chamber: bill.from_organization?.classification || bill.fromOrganization?.classification || null,
    },
    provenance: {
      channel: 'open_states',
      source_system: 'open_states',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: bill.id,
      identifier: bill.identifier,
      title: bill.title,
      classification: asArray(bill.classification),
      subjects: asArray(bill.subject || bill.subjects),
      latest_action_date: bill.latest_action_date || bill.latestActionDate || null,
      latest_action_description: bill.latest_action_description || bill.latestActionDescription || null,
      source_url: sourceUrl,
      raw: bill,
    },
  };
}

export function normalizeToStatute(bill, jurisdiction = 'us_states') {
  return normalizeOpenStatesBill(bill, { jurisdiction });
}

export async function fetchStatutes(jurisdiction = 'ca', apiKey = OPENSTATES_API_KEY, session = undefined, page = 1, pageSize = 20) {
  if (!apiKey) throw new Error('OPENSTATES_API_KEY is required for live OpenStates API fetches.');

  const params = { jurisdiction, page, per_page: pageSize, include: ['abstracts', 'versions'] };
  if (session) params.session = session;

  const response = await axios.get(`${OPENSTATES_API_BASE_URL}/bills`, {
    params,
    headers: apiHeaders(apiKey),
    timeout: 20000,
  });

  return {
    results: response.data?.results || response.data?.bills || [],
    bills: response.data?.results || response.data?.bills || [],
    pagination: response.data?.pagination || null,
    next: response.data?.pagination?.next || null,
  };
}

export async function ingestOpenStatesSignals({ bills, jurisdiction = 'us_states', apiBaseUrl } = {}) {
  const sourceBills = bills || (await fetchStatutes(jurisdiction)).results;
  const signals = sourceBills.map((bill) => normalizeOpenStatesBill(bill, { jurisdiction }));
  return postSignalsToAtlas({
    sourceId: 'open_states',
    jurisdictionId: 'us_states',
    moduleHint: 'legislative',
    signals,
    apiBaseUrl,
  });
}

export async function runIngestOpenStatesWA(_supabase = null, apiKey = OPENSTATES_API_KEY) {
  const { results } = await fetchStatutes('wa', apiKey);
  return ingestOpenStatesSignals({ bills: results, jurisdiction: 'wa' });
}

function sampleBills() {
  return [
    {
      id: 'ocd-bill/sample-atlas-openstates-1',
      identifier: 'HB 1001',
      title: 'Sample Atlas legislative activity',
      classification: ['bill'],
      subject: ['public accountability'],
      session: '2025-2026',
      updated_at: new Date().toISOString(),
      latest_action_date: new Date().toISOString().slice(0, 10),
      latest_action_description: 'Referred to committee',
      jurisdiction: { id: 'ocd-jurisdiction/country:us/state:wa/government', name: 'Washington' },
      from_organization: { classification: 'lower', name: 'House' },
      sources: [{ url: 'https://openstates.org/sample/atlas-openstates-1' }],
    },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useSample = process.argv.includes('--sample');
  const bills = useSample ? sampleBills() : (await fetchStatutes('wa')).results;
  const result = await ingestOpenStatesSignals({ bills, jurisdiction: 'wa' });
  console.log(JSON.stringify({ ok: true, source: 'open_states', mode: useSample ? 'sample' : 'live', result }, null, 2));
}

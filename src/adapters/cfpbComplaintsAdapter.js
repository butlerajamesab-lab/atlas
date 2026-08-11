import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const CFPB_API_URL = process.env.CFPB_API_URL || 'https://api.consumerfinance.gov/data-research/consumer-complaints/search.json';

export function normalizeComplaint(complaint) {
  const id = complaint.complaint_id || complaint._id || complaint.id || '';
  if (!id) throw new Error('cfpb_complaint_id_required');
  const product = complaint.product || '';
  const subProduct = complaint.sub_product || '';
  const issue = complaint.issue || '';
  const company = complaint.company || 'Unknown';
  const state = complaint.state || '';
  const dateReceived = complaint.date_received || complaint.created_date || '';
  const timely = complaint.timely || '';
  const response = complaint.company_response || '';
  const narrative = complaint.complaint_what_happened || '';

  return {
    signal_type: 'consumer_complaint',
    timestamp: toIsoTimestamp(dateReceived),
    spacetime: { region: state ? `us_state_${String(state).toLowerCase()}` : 'us_federal', jurisdiction: state ? `us_state_${String(state).toLowerCase()}` : 'us_federal', state, zip: complaint.zip_code || null },
    provenance: { channel: 'cfpb', source_system: 'cfpb_complaints_database', confidence: 1.0, source_url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${id}` },
    payload: { external_id: `cfpb_${id}`, complaint_id: id, product, sub_product: subProduct, issue, sub_issue: complaint.sub_issue || null, company, company_response: response, state, date_received: dateReceived, date_sent_to_company: complaint.date_sent_to_company || null, submitted_via: complaint.submitted_via || null, timely_response: timely === 'Yes', consumer_disputed: complaint.consumer_disputed === 'Yes', company_public_response: complaint.company_public_response || null, narrative: narrative ? narrative.slice(0, 2000) : null, disclaimer: 'A published consumer complaint is not by itself evidence of wrongdoing.' },
  };
}

function extractHits(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.hits?.hits)) return data.hits.hits.map((hit) => hit?._source || hit);
  return [];
}

export async function fetchComplaints({ state = null, product = null, minDate = null, limit = 1000 } = {}) {
  const params = { size: Math.min(Math.max(Number(limit) || 1000, 1), 5000), sort: 'created_date_desc', no_aggs: true };
  if (state) params.state = state;
  if (product) params.product = product;
  if (minDate) params.date_received_min = minDate;
  else params.date_received_min = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const response = await axios.get(CFPB_API_URL, { params, timeout: 30000, headers: { Accept: 'application/json' } });
  return extractHits(response.data).map(normalizeComplaint);
}

export async function ingestCfpbSignals({ state = null, product = null, limit = 1000, apiBaseUrl } = {}) {
  const signals = await fetchComplaints({ state, product, limit });
  if (!signals.length) return { accepted: true, ingested_count: 0, source_count: 0, note: 'No CFPB complaints returned' };
  const result = await postSignalsToAtlas({ sourceId: 'cfpb_complaints', jurisdictionId: state ? `us_state_${String(state).toLowerCase()}` : 'us_federal', moduleHint: 'consumer_protection', signals, apiBaseUrl });
  return { ...result, source_count: signals.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || null;
  const result = await ingestCfpbSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'cfpb', state, result }, null, 2));
}

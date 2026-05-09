import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const CFPB_API_BASE = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1';

export function normalizeComplaint(complaint) {
  const id = complaint.complaint_id || complaint._id || '';
  const product = complaint.product || '';
  const subProduct = complaint.sub_product || '';
  const issue = complaint.issue || '';
  const company = complaint.company || 'Unknown';
  const state = complaint.state || '';
  const dateReceived = complaint.date_received || '';
  const timely = complaint.timely || '';
  const response = complaint.company_response || '';
  const narrative = complaint.complaint_what_happened || '';

  // Flag predatory patterns
  const isPredatory = product.toLowerCase().includes('payday') ||
    product.toLowerCase().includes('debt') ||
    issue.toLowerCase().includes('fraud') ||
    issue.toLowerCase().includes('harass');

  return {
    signal_type: isPredatory ? 'predatory_finance_complaint' : 'consumer_complaint',
    timestamp: toIsoTimestamp(dateReceived),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: state ? `us_state_${state}` : 'us_federal',
      state,
      zip: complaint.zip_code || null,
    },
    provenance: {
      channel: 'cfpb',
      source_system: 'cfpb_complaints_database',
      confidence: 1.0,
      source_url: `https://www.consumerfinance.gov/data-research/consumer-complaints/search/?complaint_id=${id}`,
    },
    payload: {
      external_id: `cfpb_${id}`,
      complaint_id: id,
      product,
      sub_product: subProduct,
      issue,
      sub_issue: complaint.sub_issue || null,
      company,
      company_response: response,
      state,
      date_received: dateReceived,
      timely_response: timely === 'Yes',
      consumer_disputed: complaint.consumer_disputed === 'Yes',
      is_predatory: isPredatory,
      narrative: narrative ? narrative.slice(0, 500) : null,
    },
  };
}

export async function fetchComplaints({ state = 'WA', product = null, minDate = null, limit = 100 } = {}) {
  const params = {
    size: limit,
    sort: 'created_date_desc',
    state: state,
    no_aggs: true,
  };
  if (product) params.product = product;
  if (minDate) params.date_received_min = minDate;
  else params.date_received_min = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const response = await axios.get(`${CFPB_API_BASE}/`, { params, timeout: 30000 });
  const hits = response.data?.hits?.hits || [];
  return hits.map((hit) => normalizeComplaint(hit._source || hit));
}

export async function ingestCfpbSignals({ state = 'WA', product = null, apiBaseUrl } = {}) {
  const signals = await fetchComplaints({ state, product });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No CFPB complaints returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'cfpb_complaints',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'consumer_protection',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching CFPB complaints for ${state}...`);
  const result = await ingestCfpbSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'cfpb', state, result }, null, 2));
}

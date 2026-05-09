import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const FEC_API_BASE = 'https://api.open.fec.gov/v1';
const FEC_API_KEY = process.env.FEC_API_KEY || 'DEMO_KEY';

function fecParams(extra = {}) {
  return { api_key: FEC_API_KEY, per_page: 100, ...extra };
}

export function normalizeCommittee(committee) {
  const name = committee.name || 'Unknown Committee';
  const id = committee.committee_id || committee.id;
  const type = committee.committee_type_full || committee.committee_type || 'unknown';
  const designation = committee.designation_full || committee.designation || '';
  const party = committee.party_full || committee.party || '';
  const state = committee.state || '';
  const totalReceipts = committee.total_receipts || committee.receipts || 0;
  const totalDisbursements = committee.total_disbursements || committee.disbursements || 0;

  // Dark money indicators: Super PACs (type O/U), 527s, or committees with no party
  const isDarkMoney = ['Super PAC', 'super pac'].some(t => type.toLowerCase().includes(t.toLowerCase())) ||
    designation.includes('Unauthorized') ||
    (type.includes('Independent') && !party);

  return {
    signal_type: isDarkMoney ? 'dark_money_committee' : 'campaign_finance_committee',
    timestamp: toIsoTimestamp(committee.last_file_date || committee.first_file_date),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
      state: state || null,
    },
    provenance: {
      channel: 'fec',
      source_system: 'federal_election_commission',
      confidence: 1.0,
      source_url: `https://www.fec.gov/data/committee/${id}/`,
    },
    payload: {
      external_id: `fec_${id}`,
      committee_id: id,
      committee_name: name,
      committee_type: type,
      designation,
      party,
      state,
      total_receipts: totalReceipts,
      total_disbursements: totalDisbursements,
      is_dark_money: isDarkMoney,
      first_file_date: committee.first_file_date || null,
      last_file_date: committee.last_file_date || null,
      treasurer_name: committee.treasurer_name || null,
      candidate_ids: committee.candidate_ids || [],
    },
  };
}

export function normalizeDisbursement(disbursement) {
  const recipientName = disbursement.recipient_name || 'Unknown';
  const amount = disbursement.disbursement_amount || 0;
  const committeeId = disbursement.committee_id || '';
  const committeeName = disbursement.committee?.name || disbursement.committee_name || '';
  const purpose = disbursement.disbursement_description || disbursement.purpose || '';
  const state = disbursement.recipient_state || '';

  return {
    signal_type: 'campaign_disbursement',
    timestamp: toIsoTimestamp(disbursement.disbursement_date),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
    },
    provenance: {
      channel: 'fec',
      source_system: 'federal_election_commission',
      confidence: 1.0,
      source_url: `https://www.fec.gov/data/committee/${committeeId}/`,
    },
    payload: {
      external_id: `fec_disb_${disbursement.sub_id || disbursement.transaction_id || Math.random().toString(36).slice(2)}`,
      committee_id: committeeId,
      committee_name: committeeName,
      recipient_name: recipientName,
      recipient_state: state,
      amount,
      purpose,
      disbursement_date: disbursement.disbursement_date || null,
      category: disbursement.disbursement_type_description || null,
    },
  };
}

export async function fetchSuperPacs(state = null, cycle = 2024) {
  const params = fecParams({
    committee_type: ['O', 'U'], // Super PACs (independent expenditure only)
    cycle,
    sort: '-total_receipts',
  });
  if (state) params.state = state;

  const response = await axios.get(`${FEC_API_BASE}/committees/`, { params, timeout: 30000 });
  return (response.data?.results || []).map(normalizeCommittee);
}

export async function fetchLargeDisbursements(minAmount = 100000, cycle = 2024) {
  const params = fecParams({
    min_amount: minAmount,
    two_year_transaction_period: cycle,
    sort: '-disbursement_date',
  });

  const response = await axios.get(`${FEC_API_BASE}/schedules/schedule_b/`, { params, timeout: 30000 });
  return (response.data?.results || []).map(normalizeDisbursement);
}

export async function ingestFecSignals({ state = 'WA', cycle = 2024, minDisbursement = 50000, apiBaseUrl } = {}) {
  const [committees, disbursements] = await Promise.all([
    fetchSuperPacs(state, cycle),
    fetchLargeDisbursements(minDisbursement, cycle),
  ]);

  const signals = [...committees, ...disbursements];
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No FEC data returned' };
  }

  return postSignalsToAtlas({
    sourceId: 'fec_campaign_finance',
    jurisdictionId: 'us_federal',
    moduleHint: 'campaign_finance',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching FEC campaign finance data for ${state}...`);
  const result = await ingestFecSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'fec', state, result }, null, 2));
}

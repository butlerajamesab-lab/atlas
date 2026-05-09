import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const USA_SPENDING_BASE = 'https://api.usaspending.gov/api/v2';

export function normalizeContract(award) {
  const recipient = award.recipient || {};
  const recipientName = recipient.recipient_name || award.recipient_name || 'Unknown';
  const amount = award.total_obligation || award.Award_Amount || 0;
  const agency = award.awarding_agency?.toptier_agency?.name || award.awarding_agency_name || '';
  const subAgency = award.awarding_agency?.subtier_agency?.name || '';
  const state = recipient.location?.state_code || award.recipient_state || '';
  const description = award.description || '';
  const awardId = award.generated_internal_id || award.award_id || award.id || '';
  const startDate = award.period_of_performance_start_date || award.start_date || '';

  // Flag large no-bid contracts and repeat winners
  const isLarge = amount > 1000000;
  const signalType = isLarge ? 'large_federal_contract' : 'federal_contract_award';

  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(startDate || award.action_date),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
      agency,
    },
    provenance: {
      channel: 'usa_spending',
      source_system: 'usaspending_gov',
      confidence: 1.0,
      source_url: `https://www.usaspending.gov/award/${awardId}`,
    },
    payload: {
      external_id: `usaspend_${awardId}`,
      award_id: awardId,
      recipient_name: recipientName,
      recipient_state: state,
      recipient_uei: recipient.recipient_uei || null,
      amount,
      awarding_agency: agency,
      awarding_sub_agency: subAgency,
      description: description.slice(0, 500),
      start_date: startDate,
      end_date: award.period_of_performance_current_end_date || null,
      award_type: award.type_description || award.award_type || null,
      naics_code: award.naics_code || null,
      naics_description: award.naics_description || null,
    },
  };
}

export async function fetchRecentContracts({ state = 'WA', minAmount = 100000, limit = 100 } = {}) {
  const body = {
    filters: {
      time_period: [
        {
          start_date: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
        },
      ],
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      recipient_locations: state ? [{ country: 'USA', state }] : undefined,
      award_amounts: [{ lower_bound: minAmount }],
    },
    fields: [
      'Award ID', 'Recipient Name', 'Total Obligation', 'Awarding Agency',
      'Awarding Sub Agency', 'Start Date', 'End Date', 'Description',
      'recipient_state_code', 'generated_internal_id',
    ],
    limit,
    page: 1,
    sort: 'Total Obligation',
    order: 'desc',
  };

  const response = await axios.post(`${USA_SPENDING_BASE}/search/spending_by_award/`, body, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  const results = response.data?.results || [];
  return results.map((award) => normalizeContract({
    ...award,
    generated_internal_id: award.generated_internal_id || award['Award ID'],
    recipient_name: award['Recipient Name'],
    total_obligation: award['Total Obligation'],
    awarding_agency_name: award['Awarding Agency'],
    description: award.Description || '',
    period_of_performance_start_date: award['Start Date'],
    recipient_state: award.recipient_state_code || state,
  }));
}

export async function ingestUsaSpendingSignals({ state = 'WA', minAmount = 100000, apiBaseUrl } = {}) {
  const signals = await fetchRecentContracts({ state, minAmount });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No contracts returned' };
  }
  return postSignalsToAtlas({
    sourceId: 'usa_spending',
    jurisdictionId: 'us_federal',
    moduleHint: 'federal_contracts',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching USAspending contracts for ${state}...`);
  const result = await ingestUsaSpendingSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'usa_spending', state, result }, null, 2));
}

import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// IRS Exempt Organizations data - 527 political orgs and 501(c)(4) dark money groups
const IRS_527_SEARCH = 'https://forms.irs.gov/app/PoliticalOrgsSearch/search/results';
const IRS_EXEMPT_ORG_API = 'https://apps.irs.gov/app/eos/api';

// ProPublica's 527 data (more accessible)
const PROPUBLICA_527_BASE = 'https://projects.propublica.org/527s/api/v1';

export function normalize527Org(org) {
  const name = org.name || org.org_name || org.organization_name || 'Unknown';
  const ein = org.ein || org.EIN || '';
  const state = org.state || org.STATE || '';
  const totalReceipts = parseFloat(org.total_receipts || org.receipts || org.Total_Receipts || 0);
  const totalExpenditures = parseFloat(org.total_expenditures || org.expenditures || 0);
  const purpose = org.purpose || org.exempt_purpose || '';
  const filingDate = org.filing_date || org.date || '';

  // 527s are political organizations - they're the primary dark money vehicle
  const isLargeDarkMoney = totalReceipts > 500000;

  return {
    signal_type: isLargeDarkMoney ? 'large_dark_money_org' : 'political_527_org',
    timestamp: toIsoTimestamp(filingDate),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
      state,
    },
    provenance: {
      channel: 'irs_527',
      source_system: 'irs_political_org_filings',
      confidence: 1.0,
      source_url: ein ? `https://projects.propublica.org/527s/orgs/${ein}` : null,
    },
    payload: {
      external_id: `irs527_${ein || name.replace(/\s+/g, '_').slice(0, 30)}`,
      ein,
      organization_name: name,
      state,
      total_receipts: totalReceipts,
      total_expenditures: totalExpenditures,
      purpose: purpose.slice(0, 500),
      is_large_dark_money: isLargeDarkMoney,
      filing_date: filingDate,
      org_type: '527',
    },
  };
}

export function normalize501c4(org) {
  const name = org.name || org.organization_name || org.org_name || 'Unknown';
  const ein = org.ein || org.EIN || '';
  const state = org.state || org.STATE || '';
  const revenue = parseFloat(org.revenue_amount || org.total_revenue || 0);
  const assets = parseFloat(org.asset_amount || org.total_assets || 0);
  const nteeCode = org.ntee_code || org.NTEE || '';
  const subsection = org.subsection_code || org.subsection || '';

  // 501(c)(4) "social welfare" orgs are the other dark money vehicle
  const isLarge = revenue > 1000000;

  return {
    signal_type: isLarge ? 'large_social_welfare_org' : 'social_welfare_501c4',
    timestamp: toIsoTimestamp(org.ruling_date || org.tax_period),
    spacetime: {
      region: state ? `us_state_${state}` : 'us_federal',
      jurisdiction: 'us_federal',
      state,
    },
    provenance: {
      channel: 'irs_exempt_org',
      source_system: 'irs_exempt_organizations',
      confidence: 1.0,
      source_url: `https://apps.irs.gov/app/eos/detailsPage?ein=${ein}`,
    },
    payload: {
      external_id: `irs501c4_${ein}`,
      ein,
      organization_name: name,
      state,
      revenue,
      assets,
      ntee_code: nteeCode,
      subsection_code: subsection,
      is_large: isLarge,
      org_type: '501c4',
    },
  };
}

export async function fetch527Orgs(state = 'WA', limit = 100) {
  // Try ProPublica's 527 explorer
  try {
    const response = await axios.get(`${PROPUBLICA_527_BASE}/orgs.json`, {
      params: { state, order: 'total_receipts', per_page: limit },
      timeout: 30000,
    });
    return (response.data?.results || response.data || []).map(normalize527Org);
  } catch (e) {
    // Fallback: IRS direct search
    try {
      const response = await axios.get('https://apps.irs.gov/app/eos/api/records', {
        params: {
          stateAbbr: state,
          subsectionCodes: '27', // 527 orgs
          resultsPerPage: limit,
        },
        timeout: 30000,
      });
      return (response.data?.results || []).map(normalize527Org);
    } catch (e2) {
      console.warn(`527 fetch failed: ${e2.message}`);
      return [];
    }
  }
}

export async function fetch501c4Orgs(state = 'WA', limit = 100) {
  try {
    // ProPublica nonprofit explorer for 501(c)(4)s
    const response = await axios.get(`https://projects.propublica.org/nonprofits/api/v2/search.json`, {
      params: { 'state[id]': state, c_code: 4, page: 0 },
      timeout: 30000,
    });
    return (response.data?.organizations || []).map(normalize501c4);
  } catch (e) {
    console.warn(`501c4 fetch failed: ${e.message}`);
    return [];
  }
}

export async function ingestIrsExemptSignals({ state = 'WA', apiBaseUrl } = {}) {
  const [orgs527, orgs501c4] = await Promise.all([
    fetch527Orgs(state),
    fetch501c4Orgs(state),
  ]);

  const signals = [...orgs527, ...orgs501c4];
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No IRS exempt org data returned' };
  }

  return postSignalsToAtlas({
    sourceId: 'irs_exempt_orgs',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'dark_money',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching IRS 527/501(c)(4) dark money orgs for ${state}...`);
  const result = await ingestIrsExemptSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'irs_exempt_orgs', state, result }, null, 2));
}

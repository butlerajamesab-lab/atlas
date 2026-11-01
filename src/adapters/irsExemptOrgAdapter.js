import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

// Exempt Organizations data - 527 political orgs and 501(c)(4) groups
// SOURCE STATUS (verified live 2026-10-31):
// - IRS EOS API (apps.irs.gov/app/eos/api): answers 403 Access Denied to
//   programmatic access. NOT used as a fetch path anymore.
// - ProPublica 527 Explorer API (projects.propublica.org/527s): retired,
//   answers 404.
// - ProPublica Nonprofit Explorer does not index 527 organizations
//   (search with c_code 27 returns 404 / zero results), so no verified
//   public API source for the 527 leg currently exists; see
//   fetch527Orgs.
// - 501(c)(4) data comes from the ProPublica Nonprofit Explorer API v2,
//   which is live, keyless, and returns the record shape the
//   normalizers below were written for.
const PROPUBLICA_NONPROFIT_API = 'https://projects.propublica.org/nonprofits/api/v2';

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
  const subsection = org.subsection_code ?? org.subsection ?? org.subseccd ?? '';

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
      // The record actually served by the ProPublica Nonprofit
      // Explorer (the live source for this leg since 2026-10-31).
      source_url: ein ? `https://projects.propublica.org/nonprofits/organizations/${ein}` : null,
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
  // No verified live source (see header): ProPublica's 527 API is
  // retired (404), the IRS EOS API blocks automation (403), and the
  // Nonprofit Explorer does not index 527 organizations. Both dead
  // routes were removed rather than left to fail silently; restore
  // this leg here when a working 527 source is verified.
  console.warn('527 orgs: no live source — ProPublica 527 API retired (404), IRS EOS blocks automation (403), Nonprofit Explorer does not index 527s. Skipping 527 leg.');
  return [];
}

export async function fetch501c4Orgs(state = 'WA', limit = 100) {
  try {
    // ProPublica Nonprofit Explorer for 501(c)(4)s. The subsection
    // filter must be sent as c_code[id]; the plain c_code parameter
    // makes the API answer HTTP 500 (verified 2026-10-31).
    const hits = [];
    let page = 0;
    while (hits.length < limit) {
      const response = await axios.get(`${PROPUBLICA_NONPROFIT_API}/search.json`, {
        params: { 'state[id]': state, 'c_code[id]': 4, page },
        timeout: 30000,
      });
      const orgs = response.data?.organizations || [];
      hits.push(...orgs);
      if (!orgs.length || page >= (response.data?.num_pages ?? 1) - 1) break;
      page += 1;
    }

    // The search endpoint returns no financials; the organization
    // detail endpoint returns the full record (revenue_amount,
    // asset_amount, ruling_date, subsection_code) the normalizer
    // expects. Fall back to the search-level record if a detail
    // fetch fails.
    const records = await Promise.all(hits.slice(0, limit).map(async (hit) => {
      try {
        const detail = await axios.get(`${PROPUBLICA_NONPROFIT_API}/organizations/${hit.ein}.json`, { timeout: 30000 });
        return detail.data?.organization || hit;
      } catch (e) {
        return hit;
      }
    }));
    return records.map(normalize501c4);
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

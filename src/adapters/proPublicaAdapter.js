import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';

dotenv.config();

const PROPUBLICA_NONPROFIT_API_BASE_URL = process.env.PROPUBLICA_NONPROFIT_API_BASE_URL || 'https://projects.propublica.org/nonprofits/api/v2';

function nonprofitSourceUrl(orgOrFiling) {
  const ein = String(orgOrFiling.ein || orgOrFiling.organization?.ein || '').replace(/-/g, '');
  return sourceUrlFrom(
    orgOrFiling.pdf_url,
    orgOrFiling.source_url,
    orgOrFiling.url,
    ein ? `https://projects.propublica.org/nonprofits/organizations/${ein}` : null,
  );
}

function stateFromRecord(record, fallback = 'us_federal') {
  return record.state || record.organization?.state || record.jurisdiction || fallback;
}

export function normalizeProPublicaOrganization(org, { jurisdiction = 'us_federal' } = {}) {
  const region = stateFromRecord(org, jurisdiction);
  const sourceUrl = nonprofitSourceUrl(org);

  return {
    signal_type: 'nonprofit_registry_record',
    timestamp: toIsoTimestamp(org.updated, org.updated_at, org.created_at),
    spacetime: {
      region,
      jurisdiction: region,
      city: org.city || null,
      state: org.state || null,
    },
    provenance: {
      channel: 'pro_publica',
      source_system: 'pro_publica_nonprofit_explorer',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: org.ein,
      ein: org.ein,
      name: org.name || org.strein || null,
      ntee_code: org.ntee_code || null,
      subsection_code: org.subsection_code || null,
      revenue_amount: org.revenue_amount ?? null,
      income_amount: org.income_amount ?? null,
      asset_amount: org.asset_amount ?? null,
      source_url: sourceUrl,
      raw: org,
    },
  };
}

export function normalizeProPublicaFiling(filing, { organization = {}, jurisdiction = 'us_federal' } = {}) {
  const record = { ...filing, organization };
  const region = stateFromRecord(record, jurisdiction);
  const sourceUrl = nonprofitSourceUrl(record);
  // tax_prd is the official ProPublica tax-period field (YYYYMM).
  // This period is NOT a source update timestamp.
  const taxPeriod = filing.tax_prd ?? filing.tax_period ?? null;
  const ein = filing.ein ?? organization.ein ?? null;
  const externalId = filing.sub_id ?? (ein && taxPeriod ? `${ein}:${taxPeriod}` : null);
  if (!externalId) throw new Error('propublica_filing_identity_missing: EIN+tax_prd or sub_id required');

  return {
    signal_type: 'nonprofit_990_filing',
    timestamp: toIsoTimestamp(filing.updated, filing.updated_at),
    spacetime: {
      region,
      jurisdiction: region,
      tax_period: taxPeriod,
    },
    provenance: {
      channel: 'pro_publica',
      source_system: 'pro_publica_nonprofit_explorer',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: String(externalId),
      ein,
      organization_name: organization.name || null,
      tax_period: taxPeriod,
      form_type: filing.formtype ?? filing.form_type ?? null,
      total_revenue: filing.totrevenue ?? null,
      total_assets: filing.totassetsend ?? null,
      pdf_url: filing.pdf_url || null,
      source_url: sourceUrl,
      raw: filing,
    },
  };
}

export function normalizeToNonprofit(org, jurisdiction = 'us_federal') {
  return normalizeProPublicaOrganization(org, { jurisdiction });
}

export function normalizeToFiling(filing, organization = {}, jurisdiction = 'us_federal') {
  return normalizeProPublicaFiling(filing, { organization, jurisdiction });
}

export async function searchNonprofits(state = 'WA', page = 0, query = '') {
  const params = { 'state[id]': state.toUpperCase(), page };
  if (query) params.q = query;

  const response = await axios.get(`${PROPUBLICA_NONPROFIT_API_BASE_URL}/search.json`, {
    params,
    timeout: 20000,
  });

  return {
    organizations: response.data?.organizations || [],
    num_pages: response.data?.num_pages || 1,
  };
}

export async function fetchOrgDetail(ein) {
  const cleanEin = String(ein).replace(/-/g, '');
  const response = await axios.get(`${PROPUBLICA_NONPROFIT_API_BASE_URL}/organizations/${cleanEin}.json`, { timeout: 20000 });
  return {
    organization: response.data?.organization || {},
    filings_with_data: response.data?.filings_with_data || [],
  };
}

/**
 * Dated filings may be transported; undated search hits remain held.
 * Neither a hold nor an accepted transport receipt certifies source truth.
 */
export function prepareProPublicaSignals({ organizations = [], filings = [], jurisdiction = 'us_federal' } = {}) {
  const signals = [];
  const held = [];
  function acceptOrHold(kind, record, normalize) {
    try {
      signals.push(normalize());
    } catch (e) {
      const reason = String(e?.message ?? e);
      if (!reason.startsWith('atlas_source_timestamp_') && !reason.startsWith('propublica_filing_identity_missing')) throw e;
      held.push({
        kind,
        source_record_id: String(record?.sub_id ?? record?.ein ?? record?.strein ?? 'unidentified'),
        reason: reason.split(':')[0],
      });
    }
  }
  for (const organization of organizations) {
    acceptOrHold('organization', organization, () => normalizeProPublicaOrganization(organization, { jurisdiction }));
  }
  for (const entry of filings) {
    if (entry?.filings_with_data) {
      for (const filing of entry.filings_with_data) {
        acceptOrHold('filing', filing, () => normalizeProPublicaFiling(filing, { organization: entry.organization || {}, jurisdiction }));
      }
    } else {
      acceptOrHold('filing', entry, () => normalizeProPublicaFiling(entry, { organization: entry.organization || {}, jurisdiction }));
    }
  }
  return { signals, held };
}

export async function ingestProPublicaSignals({
  organizations = [], filings = [], jurisdiction = 'us_federal', apiBaseUrl,
  postSignals = postSignalsToAtlas,
} = {}) {
  const { signals, held } = prepareProPublicaSignals({ organizations, filings, jurisdiction });
  if (!signals.length && held.length) {
    return { accepted: false, status: 'held_source_metadata', ingested_count: 0,
      records_seen: held.length, records_failed: held.length, source_hold_count: held.length,
      source_holds: held.slice(0, 25) };
  }
  const persisted = await postSignals({
    sourceId: 'pro_publica',
    jurisdictionId: 'us_federal',
    moduleHint: 'congressional',
    signals,
    apiBaseUrl,
  });
  if (!held.length) return persisted;
  return { ...persisted, status: 'partial', partial_completion: true,
    records_failed: Number(persisted.records_failed ?? 0) + held.length,
    source_hold_count: held.length, source_holds: held.slice(0, 25) };
}

export async function runIngestProPublica(_supabase = null, state = 'WA') {
  const { organizations } = await searchNonprofits(state);
  const details = [];
  for (const organization of organizations.slice(0, 10)) {
    const ein = organization.ein;
    if (ein) details.push(await fetchOrgDetail(ein));
  }
  const detailedOrgs = new Map(details.filter((d) => d.organization?.ein).map((d) => [String(d.organization.ein), d.organization]));
  const sourceOrganizations = organizations.map((org) => detailedOrgs.get(String(org.ein)) || org);
  return ingestProPublicaSignals({ organizations: sourceOrganizations, filings: details, jurisdiction: state.toUpperCase() });
}

function sampleRecords() {
  const organization = {
    ein: '123456789',
    name: 'Sample Atlas Public Benefit Organization',
    city: 'Seattle',
    state: 'WA',
    ntee_code: 'I20',
    revenue_amount: 1000000,
    updated: new Date().toISOString(),
  };
  const filing = {
    sub_id: 'sample-990-1',
    tax_period: '202412',
    formtype: '990',
    totrevenue: 1000000,
    totassetsend: 500000,
    pdf_url: 'https://projects.propublica.org/nonprofits/download-filing?path=sample-990.pdf',
    organization,
  };
  return { organization, filing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useSample = process.argv.includes('--sample');
  const { organization, filing } = sampleRecords();
  const result = useSample
    ? await ingestProPublicaSignals({ organizations: [organization], filings: [filing], jurisdiction: 'WA' })
    : await runIngestProPublica(null, 'WA');
  console.log(JSON.stringify({ ok: true, source: 'pro_publica', mode: useSample ? 'sample' : 'live', result }, null, 2));
}

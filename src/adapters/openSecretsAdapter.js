import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const OPENSECRETS_API_BASE = 'https://www.opensecrets.org/api/';
const OPENSECRETS_API_KEY = process.env.OPENSECRETS_API_KEY || '';

// Senate Lobbying Disclosure Act data (no key needed)
const SENATE_LDA_BASE = 'https://lda.senate.gov/api/v1';

function osParams(method, extra = {}) {
  return { method, output: 'json', apikey: OPENSECRETS_API_KEY, ...extra };
}

export function normalizeLobbyingFiling(filing) {
  const registrantName = filing.registrant_name || filing.registrant?.name || 'Unknown';
  const clientName = filing.client_name || filing.client?.name || '';
  const amount = parseFloat(filing.income || filing.amount || filing.expenses || 0);
  const filingDate = filing.dt_posted || filing.filing_date || filing.received || '';
  const filingId = filing.filing_uuid || filing.id || '';
  const registrantId = filing.registrant?.id || filing.registrant_id || filing.registrant_uuid || null;
  const clientId = filing.client?.id || filing.client_id || filing.client_uuid || null;
  const issues = filing.lobbying_activities?.map(a => a.general_issue_code)?.join(', ') || filing.specific_issues || '';

  const isLarge = amount > 500000;

  return {
    signal_type: isLarge ? 'large_lobbying_expenditure' : 'lobbying_disclosure',
    timestamp: toIsoTimestamp(filingDate),
    spacetime: {
      region: 'us_federal',
      jurisdiction: 'us_federal',
    },
    provenance: {
      channel: 'senate_lda',
      source_system: 'senate_lobbying_disclosure',
      confidence: 1.0,
      source_url: `https://lda.senate.gov/filings/public/filing/${filingId}/`,
    },
    payload: {
      external_id: `lda_${filingId}`,
      filing_id: filingId,
      registrant_name: registrantName,
      client_name: clientName,
      amount,
      filing_date: filingDate,
      issues,
      is_large: isLarge,
      filing_type: filing.filing_type || filing.type || null,
      government_entities: filing.government_entities?.map(e => e.name)?.join(', ') || null,
      registrant_source_id: registrantId,
      client_source_id: clientId,
      integrity_identity_gaps: [
        !clientId ? 'missing_exact_client_id' : null,
        !registrantId ? 'missing_exact_registrant_id' : null,
      ].filter(Boolean),
      integrity_observation: clientId && registrantId && amount > 0 && filingDate ? {
        kind: 'lobbying_disclosure',
        transfer_id: `lda_${filingId}`,
        from_entity_id: `senate_lda:client:${clientId}`,
        to_entity_id: `senate_lda:registrant:${registrantId}`,
        from_entity_name: clientName,
        to_entity_name: registrantName,
        amount,
        occurred_at: filingDate,
        purpose_tags: filing.lobbying_activities?.map(a => a.general_issue_code).filter(Boolean) || [],
        jurisdiction_id: 'us_federal',
      } : null,
    },
  };
}

export function normalizeTopDonor(donor, cycle = '2024') {
  const name = donor.donor_name || donor['@attributes']?.org_name || donor.organization || 'Unknown';
  const total = parseFloat(donor.total || donor['@attributes']?.total || 0);
  const pacs = parseFloat(donor.pacs || donor['@attributes']?.pacs || 0);
  const indivs = parseFloat(donor.indivs || donor['@attributes']?.indivs || 0);

  return {
    signal_type: 'top_political_donor',
    timestamp: toIsoTimestamp(`${cycle}-01-01`),
    spacetime: {
      region: 'us_federal',
      jurisdiction: 'us_federal',
    },
    provenance: {
      channel: 'opensecrets',
      source_system: 'center_responsive_politics',
      confidence: 0.95,
      source_url: `https://www.opensecrets.org/orgs/summary?cycle=${cycle}`,
    },
    payload: {
      external_id: `os_donor_${name.replace(/\s+/g, '_').slice(0, 40)}_${cycle}`,
      organization_name: name,
      total_contributions: total,
      pac_contributions: pacs,
      individual_contributions: indivs,
      cycle,
    },
  };
}

export async function fetchLobbyingFilings({ limit = 100 } = {}) {
  try {
    const response = await axios.get(`${SENATE_LDA_BASE}/filings/`, {
      params: {
        filing_dt_posted_after: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
        ordering: '-dt_posted',
        page_size: Math.min(limit, 25),
      },
      timeout: 30000,
      headers: { Accept: 'application/json' },
    });
    const results = response.data?.results || response.data || [];
    return (Array.isArray(results) ? results : []).map(normalizeLobbyingFiling);
  } catch (e) {
    console.warn(`Senate LDA fetch failed: ${e.message}`);
    return [];
  }
}

export async function fetchTopDonors(cycle = '2024') {
  if (!OPENSECRETS_API_KEY) {
    console.warn('OPENSECRETS_API_KEY not set. Get one free at https://www.opensecrets.org/api/admin/index.php?function=signup');
    return [];
  }
  try {
    const response = await axios.get(OPENSECRETS_API_BASE, {
      params: osParams('getOrgs', { cycle }),
      timeout: 30000,
    });
    const orgs = response.data?.response?.organizations?.organization || [];
    return (Array.isArray(orgs) ? orgs : [orgs]).map((o) => normalizeTopDonor(o, cycle));
  } catch (e) {
    console.warn(`OpenSecrets fetch failed: ${e.message}`);
    return [];
  }
}

export async function ingestOpenSecretsSignals({ cycle = '2024', apiBaseUrl } = {}) {
  // The currently registered canonical stream is the public Senate LDA feed:
  // streams.stream_id=open_secrets, source_id=senate_lda, module_hint=lobbying.
  // Do not mix OpenSecrets donor records into that source identity. A separate
  // registered stream is required before donor records may be persisted.
  void cycle;
  const lobbying = await fetchLobbyingFilings({});

  if (!lobbying.length) {
    return { accepted: true, ingested_count: 0, note: 'No Senate LDA filings returned' };
  }

  return postSignalsToAtlas({
    sourceId: 'senate_lda',
    jurisdictionId: 'us_federal',
    moduleHint: 'lobbying',
    signals: lobbying,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cycle = process.argv[2] || '2024';
  console.log('Fetching Senate LDA lobbying disclosures...');
  const result = await ingestOpenSecretsSignals({ cycle });
  console.log(JSON.stringify({ ok: true, source: 'senate_lda', cycle, result }, null, 2));
}

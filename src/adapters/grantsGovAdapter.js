import axios from 'axios';
import dotenv from 'dotenv';
import { asArray, postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';

dotenv.config();

const GRANTS_GOV_API_BASE_URL = process.env.GRANTS_GOV_API_BASE_URL || 'https://api.grants.gov/v1/api';

function opportunitySourceUrl(opportunity) {
  return sourceUrlFrom(
    opportunity.source_url,
    opportunity.url,
    opportunity.synopsisUrl,
    opportunity.synopsis_url,
    opportunity.oppNumber ? `https://www.grants.gov/search-results-detail/${opportunity.oppNumber}` : null,
    opportunity.opportunityNumber ? `https://www.grants.gov/search-results-detail/${opportunity.opportunityNumber}` : null,
    opportunity.id ? `https://www.grants.gov/search-results-detail/${opportunity.id}` : null,
    opportunity.opportunityId ? `https://www.grants.gov/search-results-detail/${opportunity.opportunityId}` : null,
  );
}

function agencyFromOpportunity(opportunity) {
  return opportunity.agencyCode || opportunity.owningAgencyCode || opportunity.agency_code || opportunity.agency || opportunity.agencyName || opportunity.agency_name || 'grants_gov';
}

export function normalizeGrantsGovOpportunity(opportunity, { jurisdiction = 'us_federal' } = {}) {
  const sourceUrl = opportunitySourceUrl(opportunity);
  const agency = agencyFromOpportunity(opportunity);
  const closeDate = opportunity.closeDate || opportunity.close_date || opportunity.archiveDate || null;

  return {
    signal_type: 'grant_opportunity',
    timestamp: toIsoTimestamp(opportunity.postedDate, opportunity.posted_date, opportunity.postDate, opportunity.openDate, opportunity.lastUpdatedDate, opportunity.last_updated_date),
    spacetime: {
      region: jurisdiction,
      jurisdiction,
      agency,
      close_date: closeDate,
    },
    provenance: {
      channel: 'grants_gov',
      source_system: 'grants_gov',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: opportunity.id || opportunity.opportunityId || opportunity.opportunity_id,
      opportunity_number: opportunity.oppNumber || opportunity.opportunityNumber || opportunity.opportunity_number || null,
      title: opportunity.title || opportunity.opportunityTitle || opportunity.opportunity_title || null,
      agency,
      category: opportunity.fundingInstrumentType || opportunity.funding_instrument_type || opportunity.oppCategory || null,
      eligibility: asArray(opportunity.eligibility || opportunity.eligibleApplicants || opportunity.eligible_applicants),
      close_date: closeDate,
      source_url: sourceUrl,
      raw: opportunity,
    },
  };
}

export function normalizeToGrant(opportunity, jurisdiction = 'us_federal') {
  return normalizeGrantsGovOpportunity(opportunity, { jurisdiction });
}

export async function searchOpportunities(keyword = '', startRecord = 1, rows = 25) {
  const response = await axios.post(
    `${GRANTS_GOV_API_BASE_URL}/search2`,
    {
      keyword,
      rows,
      startRecord,
      oppStatuses: 'posted',
    },
    { timeout: 20000 },
  );

  return {
    oppHits: response.data?.data?.oppHits || response.data?.oppHits || [],
    hitCount: response.data?.data?.hitCount || response.data?.hitCount || 0,
  };
}

export async function fetchOpportunityDetail(opportunityNumber) {
  const response = await axios.post(
    `${GRANTS_GOV_API_BASE_URL}/fetchOpportunity`,
    { opportunityNumber },
    { timeout: 20000 },
  );
  return response.data?.data?.opportunity || response.data?.opportunity || response.data?.data || response.data;
}

export async function ingestGrantsGovSignals({ opportunities, jurisdiction = 'us_federal', apiBaseUrl } = {}) {
  const sourceOpportunities = opportunities || (await searchOpportunities()).oppHits;
  const signals = sourceOpportunities.map((opportunity) => normalizeGrantsGovOpportunity(opportunity, { jurisdiction }));
  return postSignalsToAtlas({
    sourceId: 'grants_gov',
    jurisdictionId: 'us_federal',
    moduleHint: 'grants',
    signals,
    apiBaseUrl,
  });
}

export async function runIngestGrantsGov(_supabase = null, keyword = '') {
  const { oppHits } = await searchOpportunities(keyword);
  return ingestGrantsGovSignals({ opportunities: oppHits });
}

function sampleOpportunities() {
  return [
    {
      id: 'grants-gov-sample-1',
      oppNumber: 'ATLAS-2026-001',
      title: 'Sample public accountability grant opportunity',
      agencyCode: 'DOJ',
      postedDate: new Date().toISOString().slice(0, 10),
      closeDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      synopsisUrl: 'https://www.grants.gov/search-results-detail/ATLAS-2026-001',
    },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useSample = process.argv.includes('--sample');
  const opportunities = useSample ? sampleOpportunities() : (await searchOpportunities()).oppHits;
  const result = await ingestGrantsGovSignals({ opportunities });
  console.log(JSON.stringify({ ok: true, source: 'grants_gov', mode: useSample ? 'sample' : 'live', result }, null, 2));
}

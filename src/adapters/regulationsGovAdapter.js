import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const REGULATIONS_API_BASE = 'https://api.regulations.gov/v4';
const REGULATIONS_API_KEY = process.env.REGULATIONS_GOV_API_KEY || '';

function apiHeaders() {
  return REGULATIONS_API_KEY
    ? { 'X-Api-Key': REGULATIONS_API_KEY, Accept: 'application/json' }
    : { Accept: 'application/json' };
}

export function normalizeDocument(doc) {
  const attrs = doc.attributes || doc;
  const id = doc.id || attrs.documentId || attrs.objectId;
  const title = attrs.title || 'Untitled Document';
  const agencyId = attrs.agencyId || attrs.agency_id || 'unknown';
  const documentType = attrs.documentType || attrs.document_type || 'Rule';
  const postedDate = attrs.postedDate || attrs.posted_date;
  const docketId = attrs.docketId || attrs.docket_id || null;
  const commentCount = attrs.numberOfCommentsReceived || 0;

  return {
    signal_type: 'federal_rulemaking',
    timestamp: toIsoTimestamp(postedDate),
    spacetime: {
      region: 'us_federal',
      jurisdiction: 'us_federal',
      agency: agencyId,
    },
    provenance: {
      channel: 'regulations_gov',
      source_system: 'regulations_gov_api',
      confidence: 1.0,
      source_url: `https://www.regulations.gov/document/${id}`,
    },
    payload: {
      external_id: `regsgov_${id}`,
      document_id: id,
      title,
      agency_id: agencyId,
      document_type: documentType,
      docket_id: docketId,
      posted_date: postedDate,
      comment_count: commentCount,
      comment_start_date: attrs.commentStartDate || null,
      comment_end_date: attrs.commentEndDate || null,
      withdrawn: attrs.withdrawn || false,
      source_url: `https://www.regulations.gov/document/${id}`,
    },
  };
}

export async function fetchRecentDocuments({ agency = null, documentType = 'Rule', limit = 100, page = 1 } = {}) {
  if (!REGULATIONS_API_KEY) {
    console.warn('REGULATIONS_GOV_API_KEY not set. Get one free at https://api.data.gov/signup/');
    return [];
  }

  const params = {
    'filter[documentType]': documentType,
    'page[size]': Math.min(limit, 250),
    'page[number]': page,
    sort: '-postedDate',
  };
  if (agency) params['filter[agencyId]'] = agency;

  const response = await axios.get(`${REGULATIONS_API_BASE}/documents`, {
    params,
    headers: apiHeaders(),
    timeout: 30000,
  });

  return (response.data?.data || []).map(normalizeDocument);
}

export async function ingestRegulationsSignals({ agency = null, documentType = 'Rule', limit = 100, apiBaseUrl } = {}) {
  const signals = await fetchRecentDocuments({ agency, documentType, limit });
  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'No documents returned (API key required)' };
  }
  return postSignalsToAtlas({
    sourceId: 'regulations_gov',
    jurisdictionId: 'us_federal',
    moduleHint: 'regulatory',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const agency = process.argv[2] || null;
  console.log(`Fetching Regulations.gov documents${agency ? ` for ${agency}` : ''}...`);
  const result = await ingestRegulationsSignals({ agency });
  console.log(JSON.stringify({ ok: true, source: 'regulations_gov', agency, result }, null, 2));
}

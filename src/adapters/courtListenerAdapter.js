import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';

dotenv.config();

const COURTLISTENER_API_BASE_URL = process.env.COURTLISTENER_API_BASE_URL || 'https://www.courtlistener.com/api/rest/v3';
const COURTLISTENER_API_KEY = process.env.COURTLISTENER_API_KEY || process.env.COURT_LISTENER_TOKEN;

function authHeaders(token = COURTLISTENER_API_KEY) {
  return token ? { Authorization: `Token ${token}`, Accept: 'application/json' } : { Accept: 'application/json' };
}

function opinionSourceUrl(opinion) {
  const clusterId = opinion.cluster_id || opinion.cluster?.id;
  return sourceUrlFrom(
    opinion.absolute_url ? `https://www.courtlistener.com${opinion.absolute_url}` : null,
    opinion.cluster?.absolute_url ? `https://www.courtlistener.com${opinion.cluster.absolute_url}` : null,
    clusterId ? `https://www.courtlistener.com/opinion/${clusterId}/` : null,
    opinion.download_url,
  );
}

function jurisdictionFromOpinion(opinion, fallback = 'us_federal') {
  return (
    opinion.cluster?.docket?.court_id ||
    opinion.cluster?.docket?.court?.id ||
    opinion.court_id ||
    opinion.jurisdiction ||
    fallback
  );
}

export function normalizeCourtListenerOpinion(opinion, { jurisdiction = 'us_federal', signalType = 'new_court_opinion' } = {}) {
  const sourceUrl = opinionSourceUrl(opinion);
  const region = jurisdictionFromOpinion(opinion, jurisdiction);
  const courtName = opinion.cluster?.docket?.court?.full_name || opinion.cluster?.docket?.court || opinion.court || null;
  const title = opinion.cluster?.case_name || opinion.case_name || opinion.name || 'CourtListener opinion';

  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(opinion.date_created, opinion.cluster?.date_filed, opinion.date_filed),
    spacetime: {
      region,
      jurisdiction: region,
      court: courtName,
      date_filed: opinion.cluster?.date_filed || opinion.date_filed || null,
    },
    provenance: {
      channel: 'court_listener',
      source_system: 'court_listener',
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: opinion.id,
      title,
      court: courtName,
      docket_number: opinion.cluster?.docket?.docket_number || opinion.docket_number || null,
      cluster_id: opinion.cluster_id || opinion.cluster?.id || null,
      source_url: sourceUrl,
      raw: opinion,
    },
  };
}

export function normalizeToCase(opinion, jurisdiction = 'us_federal') {
  return normalizeCourtListenerOpinion(opinion, { jurisdiction, signalType: 'court_activity' });
}

export async function fetchOpinions(jurisdiction = 'us_federal', token = COURTLISTENER_API_KEY, page = 1, pageSize = 20) {
  const params = { format: 'json', page, page_size: pageSize, ordering: '-date_created' };
  if (jurisdiction && jurisdiction !== 'us_federal') params.cluster__docket__court__jurisdiction = jurisdiction;

  const response = await axios.get(`${COURTLISTENER_API_BASE_URL}/opinions/`, {
    params,
    headers: authHeaders(token),
    timeout: 20000,
  });

  return {
    results: response.data?.results || [],
    next: response.data?.next || null,
  };
}

export async function fetchClusters(jurisdiction = 'us_federal', token = COURTLISTENER_API_KEY, page = 1, pageSize = 20) {
  const params = { format: 'json', page, page_size: pageSize };
  if (jurisdiction && jurisdiction !== 'us_federal') params.docket__court__jurisdiction = jurisdiction;

  const response = await axios.get(`${COURTLISTENER_API_BASE_URL}/clusters/`, {
    params,
    headers: authHeaders(token),
    timeout: 20000,
  });

  return {
    results: response.data?.results || [],
    next: response.data?.next || null,
  };
}

export async function ingestCourtListenerSignals({ opinions, jurisdiction = 'us_federal', signalType = 'new_court_opinion', apiBaseUrl } = {}) {
  const sourceOpinions = opinions || (await fetchOpinions(jurisdiction)).results;
  const signals = sourceOpinions.map((opinion) => normalizeCourtListenerOpinion(opinion, { jurisdiction, signalType }));
  return postSignalsToAtlas({
    sourceId: 'court_listener',
    jurisdictionId: 'us_federal',
    moduleHint: 'judicial',
    signals,
    apiBaseUrl,
  });
}

export async function runIngestCourtListener(_supabase = null, token = COURTLISTENER_API_KEY, jurisdiction = 'us_federal') {
  const { results } = await fetchOpinions(jurisdiction, token);
  return ingestCourtListenerSignals({ opinions: results, jurisdiction });
}

function sampleOpinions() {
  return [
    {
      id: 'courtlistener-sample-1',
      cluster_id: 'sample-cluster-1',
      date_created: new Date().toISOString(),
      cluster: {
        id: 'sample-cluster-1',
        case_name: 'Sample v. Atlas',
        date_filed: new Date().toISOString().slice(0, 10),
        docket: { docket_number: '24-ATLAS', court_id: 'ca9', court: { full_name: 'United States Court of Appeals for the Ninth Circuit' } },
      },
      absolute_url: '/opinion/sample-cluster-1/sample-v-atlas/',
    },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useSample = process.argv.includes('--sample');
  const opinions = useSample ? sampleOpinions() : (await fetchOpinions()).results;
  const result = await ingestCourtListenerSignals({ opinions });
  console.log(JSON.stringify({ ok: true, source: 'court_listener', mode: useSample ? 'sample' : 'live', result }, null, 2));
}

import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';
import { heldSourceWindow } from './sourceWindow.js';
import { evaluateAdapterCliReceipt } from '../services/adapterReceiptAcceptance.js';

dotenv.config();

const COURTLISTENER_API_BASE_URL = process.env.COURTLISTENER_API_BASE_URL || 'https://www.courtlistener.com/api/rest/v3';
// Name history matters here: the legacy (pre-2026-05-09) adapter
// documented COURT_LISTENER_TOKEN, and the production environment
// carries the value under COURTLISTENER_API_TOKEN — a name this
// adapter did not read, so the stream ran with no Authorization
// header at all and CourtListener answered "Authentication
// credentials were not provided" (screenshot-verified 2026-10-31).
// Read the canonical name first, then the names that actually
// exist in the wild, so a misnamed variable degrades loudly in
// review instead of silently killing the stream.
const COURTLISTENER_API_KEY = process.env.COURTLISTENER_API_KEY || process.env.COURTLISTENER_API_TOKEN || process.env.COURT_LISTENER_TOKEN;

function authHeaders(token = COURTLISTENER_API_KEY) {
  return token ? { Authorization: `Token ${token}`, Accept: 'application/json' } : { Accept: 'application/json' };
}

// CourtListener answers auth failures with distinct bodies that decide
// the fix: "Authentication credentials were not provided" (no usable
// Authorization header reached it), "Invalid token." (a token arrived
// and was rejected), and "Invalid token header..." (malformed value).
// Axios's default error message discards that body, leaving only
// "Request failed with status code 401" — which hid which failure this
// was throughout the 2026-10-31 repair session. Surface it.
function courtListenerError(error, endpoint) {
  const status = error?.response?.status ?? null;
  const body = error?.response?.data;
  const detail = typeof body === 'string' ? body : body?.detail || body?.error || null;
  const wrapped = new Error(
    `courtlistener_request_failed endpoint=${endpoint}` +
    `${status ? ` status=${status}` : ''}` +
    `${detail ? ` detail=${String(detail).slice(0, 240)}` : ''}`
  );
  wrapped.cause = error;
  return wrapped;
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
  // CourtListener's ordering parameter is `order_by`, not DRF's
  // default `ordering` (FLP REST API v3 docs: "you can order
  // using any of these fields in conjunction with the order_by
  // parameter"). This adapter sent `ordering` from its 2026-05-09
  // rewrite onward; the pre-rewrite adapter sent no ordering
  // parameter and fetched successfully in April 2026. With the
  // credential fault repaired on 2026-10-31, the authenticated
  // request failed HTTP 400 — this parameter is the one delta
  // from the last request shape known to have worked.
  const params = { format: 'json', page, page_size: pageSize, order_by: '-date_created' };
  if (jurisdiction && jurisdiction !== 'us_federal') params.cluster__docket__court__jurisdiction = jurisdiction;

  let response;
  try {
    response = await axios.get(`${COURTLISTENER_API_BASE_URL}/opinions/`, {
      params,
      headers: authHeaders(token),
      timeout: 20000,
    });
  } catch (e) {
    throw courtListenerError(e, 'opinions');
  }

  if (!Array.isArray(response.data?.results) || !Object.hasOwn(response.data, 'next')) {
    throw new Error('courtlistener_unverifiable_pagination_response');
  }
  return {
    results: response.data.results,
    next: response.data.next,
  };
}

export async function fetchClusters(jurisdiction = 'us_federal', token = COURTLISTENER_API_KEY, page = 1, pageSize = 20) {
  const params = { format: 'json', page, page_size: pageSize };
  if (jurisdiction && jurisdiction !== 'us_federal') params.docket__court__jurisdiction = jurisdiction;

  let response;
  try {
    response = await axios.get(`${COURTLISTENER_API_BASE_URL}/clusters/`, {
      params,
      headers: authHeaders(token),
      timeout: 20000,
    });
  } catch (e) {
    throw courtListenerError(e, 'clusters');
  }

  return {
    results: response.data?.results || [],
    next: response.data?.next || null,
  };
}

export async function ingestCourtListenerSignals({ opinions, jurisdiction = 'us_federal', signalType = 'new_court_opinion', apiBaseUrl, token = COURTLISTENER_API_KEY, fetchPage = fetchOpinions, postSignals = postSignalsToAtlas } = {}) {
  if (opinions === undefined) return runIngestCourtListener(null, token, jurisdiction, fetchPage, postSignals);
  const sourceOpinions = opinions;
  const signals = sourceOpinions.map((opinion) => normalizeCourtListenerOpinion(opinion, { jurisdiction, signalType }));
  return postSignals({
    sourceId: 'court_listener',
    jurisdictionId: 'us_federal',
    moduleHint: 'judicial',
    signals,
    apiBaseUrl,
  });
}

export async function runIngestCourtListener(_supabase = null, token = COURTLISTENER_API_KEY, jurisdiction = 'us_federal', fetchPage = fetchOpinions, postSignals = postSignalsToAtlas) {
  const { results, next } = await fetchPage(jurisdiction, token);
  if (!Array.isArray(results) || next === undefined) throw new Error('courtlistener_unverifiable_pagination_response');
  // No second API call or publication from an incomplete first-page window.
  if (next !== null) return heldSourceWindow('court_listener', results.length);
  return ingestCourtListenerSignals({ opinions: results, jurisdiction, postSignals });
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
  const result = useSample
    ? await ingestCourtListenerSignals({ opinions: sampleOpinions() })
    : await runIngestCourtListener();
  const cli = evaluateAdapterCliReceipt(result);
  if (!cli.ok) process.exitCode = cli.exit_code;
  console.log(JSON.stringify({ ok: cli.ok, source: 'court_listener', mode: useSample ? 'sample' : 'live', result, error: cli.reason }, null, 2));
}

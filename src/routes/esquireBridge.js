import { Router } from 'express';

const DEFAULT_ESQUIRE_BASE_URL = 'https://okez6aclet-lbwghbbjna-uk.a.run.app';
const REQUEST_TIMEOUT_MS = 5000;

export function createUnavailableEsquireFallback(caseId, error) {
  return {
    case_id: caseId,
    case_type: null,
    availability: {
      esquire: 'unavailable',
      errors: [error],
    },
  };
}

export async function fetchEsquireView(caseId, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || process.env.ESQUIRE_BASE_URL || DEFAULT_ESQUIRE_BASE_URL).replace(/\/$/, '');
  const targetUrl = `${baseUrl}/cases/${encodeURIComponent(caseId)}/esquire-view`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(targetUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`esquire_invalid_json_${response.status}`);
    }

    console.log(JSON.stringify({
      case_id: caseId,
      service_name: 'esquire',
      endpoint: '/cases/:caseId/esquire-view',
      target_url: targetUrl,
      timestamp: new Date().toISOString(),
      result: 'success',
      status_code: response.status,
    }));

    return {
      ok: true,
      status: response.status,
      data: payload,
      targetUrl,
    };
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === 'AbortError' ? 'esquire_timeout' : error.message)
      : String(error);

    console.log(JSON.stringify({
      case_id: caseId,
      service_name: 'esquire',
      endpoint: '/cases/:caseId/esquire-view',
      target_url: targetUrl,
      timestamp: new Date().toISOString(),
      result: 'failure',
      error: message,
    }));

    return {
      ok: false,
      status: 502,
      data: createUnavailableEsquireFallback(caseId, message),
      targetUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function esquireBridgeRouter() {
  const router = Router();

  router.get('/cases/:caseId/esquire-view', async (req, res) => {
    const result = await fetchEsquireView(req.params.caseId);
    return res.status(result.status).json(result.data);
  });

  return router;
}

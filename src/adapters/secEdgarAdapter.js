import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const SEC_EDGAR_BASE = 'https://efts.sec.gov/LATEST/search-index';
const SEC_FULL_TEXT = 'https://efts.sec.gov/LATEST/search';
const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions';
const USER_AGENT = process.env.SEC_USER_AGENT || 'AtlasStreamingEngine/1.0 (atlas@luminari.app)';

function secHeaders() {
  return { 'User-Agent': USER_AGENT, Accept: 'application/json' };
}

export function normalizeSecFiling(filing) {
  const form = filing.form || filing.formType || '';
  const company = filing.companyName || filing.entity_name || filing.display_names?.[0] || 'Unknown';
  const cik = filing.entity_id || filing.cik || '';
  const filedDate = filing.file_date || filing.filed || filing.dateFiled || '';
  const description = filing.display_description || filing.description || '';

  // Flag suspicious filings: insider trades (Form 4), 8-K material events, 13F institutional holdings
  const isInsiderTrade = ['4', '4/A'].includes(form);
  const isMaterialEvent = form.startsWith('8-K');
  const isInstitutional = form.startsWith('13F');

  let signalType = 'corporate_filing';
  if (isInsiderTrade) signalType = 'insider_trade';
  else if (isMaterialEvent) signalType = 'material_corporate_event';
  else if (isInstitutional) signalType = 'institutional_holdings';

  return {
    signal_type: signalType,
    timestamp: toIsoTimestamp(filedDate),
    spacetime: {
      region: 'us_federal',
      jurisdiction: 'us_federal',
    },
    provenance: {
      channel: 'sec_edgar',
      source_system: 'sec_edgar',
      confidence: 1.0,
      source_url: filing.file_url || `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${form}`,
    },
    payload: {
      external_id: `sec_${cik}_${form}_${filedDate}`,
      cik,
      company_name: company,
      form_type: form,
      filed_date: filedDate,
      description,
      is_insider_trade: isInsiderTrade,
      is_material_event: isMaterialEvent,
      is_institutional: isInstitutional,
      file_url: filing.file_url || null,
      accession_number: filing.accession_number || filing.accession_no || null,
    },
  };
}

export async function fetchRecentFilings({ formType = '4', dateRange = '30d', limit = 100 } = {}) {
  // Use EDGAR full-text search API
  const params = {
    q: '*',
    forms: formType,
    dateRange: `custom`,
    startdt: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    enddt: new Date().toISOString().slice(0, 10),
    hits: { n: limit },
  };

  try {
    const response = await axios.get(SEC_FULL_TEXT, {
      params: {
        q: '*',
        forms: formType,
        dateRange: 'custom',
        startdt: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        enddt: new Date().toISOString().slice(0, 10),
      },
      headers: secHeaders(),
      timeout: 30000,
    });
    const hits = response.data?.hits?.hits || response.data?.filings || [];
    return hits.map((hit) => normalizeSecFiling(hit._source || hit));
  } catch (e) {
    // Fallback: use the RSS feed approach
    console.warn(`SEC EDGAR search failed: ${e.message}. Trying RSS fallback.`);
    return fetchEdgarRss(formType, limit);
  }
}

async function fetchEdgarRss(formType = '4', limit = 40) {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${formType}&dateb=&owner=include&count=${limit}&search_text=&output=atom`;
  try {
    const response = await axios.get(url, { headers: secHeaders(), timeout: 30000 });
    // Parse basic info from atom feed entries
    const entries = response.data.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.slice(0, limit).map((entry) => {
      const title = entry.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || '';
      const updated = entry.match(/<updated>(.*?)<\/updated>/)?.[1] || '';
      const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] || '';
      const [form, ...rest] = title.split(' - ');
      const company = rest.join(' - ').trim();
      return normalizeSecFiling({
        form: form.trim(),
        companyName: company,
        dateFiled: updated,
        file_url: link,
        cik: link.match(/CIK=(\d+)/)?.[1] || '',
      });
    });
  } catch (e) {
    console.warn(`SEC RSS fallback also failed: ${e.message}`);
    return [];
  }
}

export async function ingestSecSignals({ formTypes = ['4', '8-K', '13F-HR'], apiBaseUrl } = {}) {
  const allSignals = [];
  for (const formType of formTypes) {
    const signals = await fetchRecentFilings({ formType, limit: 50 });
    allSignals.push(...signals);
  }

  if (!allSignals.length) {
    return { accepted: true, ingested_count: 0, note: 'No SEC filings returned' };
  }

  return postSignalsToAtlas({
    sourceId: 'sec_edgar',
    jurisdictionId: 'us_federal',
    moduleHint: 'corporate_finance',
    signals: allSignals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Fetching SEC EDGAR filings (Form 4, 8-K, 13F)...');
  const result = await ingestSecSignals({});
  console.log(JSON.stringify({ ok: true, source: 'sec_edgar', result }, null, 2));
}

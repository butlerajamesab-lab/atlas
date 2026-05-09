import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const BLS_API_BASE = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const BLS_API_KEY = process.env.BLS_API_KEY || '';

// LAUS series IDs for WA state and major metro areas
const WA_SERIES = {
  'WA_state_unemployment': 'LASST530000000000003',
  'WA_state_labor_force': 'LASST530000000000006',
  'Seattle_unemployment': 'LAUMT534266000000003',
  'Spokane_unemployment': 'LAUMT534490000000003',
  'Tacoma_unemployment': 'LAUMT534586000000003',
  'Olympia_unemployment': 'LAUMT533658000000003',
  'Vancouver_unemployment': 'LAUMT534174000000003',
  'Bellingham_unemployment': 'LAUMT530746000000003',
  'Yakima_unemployment': 'LAUMT534990000000003',
  'Kennewick_unemployment': 'LAUMT532862000000003',
};

export function normalizeBlsSeries(seriesId, seriesName, dataPoints) {
  return dataPoints.map((point) => {
    const year = point.year;
    const period = point.period; // M01-M12
    const month = period.replace('M', '').padStart(2, '0');
    const value = parseFloat(point.value);

    return {
      signal_type: 'employment_metric',
      timestamp: toIsoTimestamp(`${year}-${month}-01`),
      spacetime: {
        region: 'us_state_WA',
        jurisdiction: 'us_state_WA',
        area: seriesName.replace(/_/g, ' '),
      },
      provenance: {
        channel: 'bls_laus',
        source_system: 'bureau_of_labor_statistics',
        confidence: 1.0,
        source_url: `https://data.bls.gov/timeseries/${seriesId}`,
      },
      payload: {
        external_id: `bls_${seriesId}_${year}_${month}`,
        series_id: seriesId,
        series_name: seriesName,
        year,
        month,
        value,
        period_name: point.periodName || null,
      },
    };
  });
}

export async function fetchBlsData(seriesIds, startYear = '2023', endYear = '2024') {
  const body = {
    seriesid: seriesIds,
    startyear: startYear,
    endyear: endYear,
  };
  if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;

  const response = await axios.post(BLS_API_BASE, body, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data?.Results?.series || [];
}

export async function ingestBlsSignals({ startYear = '2023', endYear = '2024', apiBaseUrl } = {}) {
  const seriesIds = Object.values(WA_SERIES);
  const seriesNames = Object.keys(WA_SERIES);
  const results = await fetchBlsData(seriesIds, startYear, endYear);

  const signals = [];
  results.forEach((series, idx) => {
    const name = seriesNames[idx] || series.seriesID;
    const dataPoints = series.data || [];
    signals.push(...normalizeBlsSeries(series.seriesID, name, dataPoints));
  });

  if (!signals.length) {
    return { accepted: true, ingested_count: 0, note: 'BLS returned no data' };
  }

  return postSignalsToAtlas({
    sourceId: 'bls_laus',
    jurisdictionId: 'us_state_WA',
    moduleHint: 'employment',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const startYear = process.argv[2] || '2023';
  const endYear = process.argv[3] || '2024';
  console.log(`Fetching BLS employment data ${startYear}-${endYear}...`);
  const result = await ingestBlsSignals({ startYear, endYear });
  console.log(JSON.stringify({ ok: true, source: 'bls_laus', result }, null, 2));
}

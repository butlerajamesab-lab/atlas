import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const USDA_FNS_API = 'https://usda-fns-snap-retailer-locator.hub.arcgis.com/api/v3/datasets';
const SNAP_RETAILER_URL = 'https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/Store_Locations/FeatureServer/0/query';

export function normalizeSnapRetailer(feature) {
  const attrs = feature.attributes || feature;
  const geo = feature.geometry || {};
  const name = attrs.Store_Name || attrs.store_name || 'Unknown Retailer';
  const city = attrs.City || attrs.city || '';
  const state = attrs.State || attrs.state || 'WA';
  const zip = attrs.Zip5 || attrs.zip || '';
  const address = attrs.Address || attrs.address || '';
  const lat = geo.y || attrs.latitude || attrs.Latitude || null;
  const lng = geo.x || attrs.longitude || attrs.Longitude || null;

  return {
    signal_type: 'snap_retailer_location',
    timestamp: toIsoTimestamp(),
    spacetime: {
      region: `us_state_${state}`,
      jurisdiction: `us_state_${state}`,
      city,
      zip,
      latitude: lat,
      longitude: lng,
    },
    provenance: {
      channel: 'usda_fns',
      source_system: 'usda_snap_retailer_locator',
      confidence: 1.0,
      source_url: 'https://www.fns.usda.gov/snap/retailer-locator',
    },
    payload: {
      external_id: `snap_${attrs.ObjectId || attrs.OBJECTID || attrs.Store_Name || Math.random().toString(36).slice(2)}`,
      store_name: name,
      address,
      city,
      state,
      zip,
      latitude: lat,
      longitude: lng,
      store_type: attrs.Store_Type || attrs.store_type || null,
    },
  };
}

export async function fetchSnapRetailers(state = 'WA', limit = 500) {
  const where = `State = '${state}'`;
  const params = {
    where,
    outFields: '*',
    resultRecordCount: limit,
    f: 'json',
    returnGeometry: true,
  };
  const response = await axios.get(SNAP_RETAILER_URL, { params, timeout: 30000 });
  const features = response.data?.features || [];
  return features.map(normalizeSnapRetailer);
}

export async function ingestSnapSignals({ state = 'WA', limit = 500, apiBaseUrl } = {}) {
  const signals = await fetchSnapRetailers(state, limit);
  return postSignalsToAtlas({
    sourceId: 'usda_snap',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'food_security',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || 'WA';
  console.log(`Fetching USDA SNAP retailers for ${state}...`);
  const result = await ingestSnapSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'usda_snap', state, result }, null, 2));
}

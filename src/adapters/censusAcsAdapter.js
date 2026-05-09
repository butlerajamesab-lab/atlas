import axios from 'axios';
import dotenv from 'dotenv';
import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';
dotenv.config();

const CENSUS_API_BASE = 'https://api.census.gov/data';
const CENSUS_API_KEY = process.env.CENSUS_API_KEY || '';
const ACS_YEAR = process.env.ACS_YEAR || '2022';

// ACS 5-year estimates: poverty, population, median income by county
const VARIABLES = [
  'B01003_001E', // total population
  'B17001_002E', // below poverty level
  'B19013_001E', // median household income
  'B25077_001E', // median home value
  'B23025_005E', // unemployed
  'B23025_002E', // in labor force
  'NAME',
];

function buildUrl(state = '53') {
  const vars = VARIABLES.join(',');
  const key = CENSUS_API_KEY ? `&key=${CENSUS_API_KEY}` : '';
  return `${CENSUS_API_BASE}/${ACS_YEAR}/acs/acs5?get=${vars}&for=county:*&in=state:${state}${key}`;
}

export function normalizeCensusCounty(row, headers) {
  const get = (varName) => {
    const idx = headers.indexOf(varName);
    return idx >= 0 ? row[idx] : null;
  };
  const population = Number(get('B01003_001E')) || 0;
  const belowPoverty = Number(get('B17001_002E')) || 0;
  const medianIncome = Number(get('B19013_001E')) || null;
  const medianHomeValue = Number(get('B25077_001E')) || null;
  const unemployed = Number(get('B23025_005E')) || 0;
  const laborForce = Number(get('B23025_002E')) || 1;
  const name = get('NAME') || 'Unknown County';
  const state = get('state') || '53';
  const county = get('county') || '000';
  const povertyRate = population > 0 ? (belowPoverty / population) : 0;
  const unemploymentRate = laborForce > 0 ? (unemployed / laborForce) : 0;
  const fips = `${state}${county}`;

  return {
    signal_type: 'demographic_baseline',
    timestamp: toIsoTimestamp(`${ACS_YEAR}-01-01`),
    spacetime: {
      region: `us_county_${fips}`,
      jurisdiction: `us_state_${state}`,
      county_fips: fips,
      county_name: name,
    },
    provenance: {
      channel: 'census_acs',
      source_system: 'us_census_bureau',
      confidence: 1.0,
      source_url: `https://data.census.gov/table?g=050XX00US${fips}`,
    },
    payload: {
      external_id: `census_acs_${ACS_YEAR}_${fips}`,
      county_name: name,
      fips,
      population,
      below_poverty: belowPoverty,
      poverty_rate: Math.round(povertyRate * 10000) / 100,
      median_household_income: medianIncome,
      median_home_value: medianHomeValue,
      unemployed,
      labor_force: laborForce,
      unemployment_rate: Math.round(unemploymentRate * 10000) / 100,
      acs_year: ACS_YEAR,
    },
  };
}

export async function fetchCensusCounties(state = '53') {
  const url = buildUrl(state);
  const response = await axios.get(url, { timeout: 30000 });
  const [headers, ...rows] = response.data;
  return rows.map((row) => normalizeCensusCounty(row, headers));
}

export async function ingestCensusSignals({ state = '53', apiBaseUrl } = {}) {
  const signals = await fetchCensusCounties(state);
  return postSignalsToAtlas({
    sourceId: 'census_acs',
    jurisdictionId: `us_state_${state}`,
    moduleHint: 'demographic',
    signals,
    apiBaseUrl,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const state = process.argv[2] || '53'; // WA = 53
  console.log(`Fetching Census ACS data for state FIPS ${state}...`);
  const result = await ingestCensusSignals({ state });
  console.log(JSON.stringify({ ok: true, source: 'census_acs', state, result }, null, 2));
}

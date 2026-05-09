import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';

dotenv.config();

const baseUrl = process.env.ATLAS_API_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
const unique = Date.now();
const now = new Date(Date.now() - 48 * 3600_000).toISOString();

async function main() {
  const signals = Array.from({ length: 4 }, (_, index) => ({
    signal_type: 'ada_filing',
    timestamp: now,
    spacetime: {
      region: 'Cook County, IL',
      jurisdiction: 'Cook County, IL',
      county: 'Cook',
      state: 'IL',
    },
    provenance: {
      channel: 'eeoc',
      source_system: 'eeoc',
      confidence: 1.0,
      source_url: `https://www.eeoc.gov/data/atlas-${unique}-${index}`,
    },
    payload: {
      external_id: `atlas-eeoc-${unique}-${index}`,
      complaint_type: 'ada_filing',
      employer: 'Sample Atlas Employer Services',
      source_url: `https://www.eeoc.gov/data/atlas-${unique}-${index}`,
    },
  }));

  const health = (await axios.get(`${baseUrl}/health`)).data;
  const ingest = (await axios.post(`${baseUrl}/v1/ingest/signals`, {
    source_id: 'eeoc',
    jurisdiction_id: 'us_federal',
    module_hint: 'civil_rights',
    signals,
  })).data;

  const cursor = (await axios.post(`${baseUrl}/v1/streams/eeoc_filings/cursors`, {
    name: `bridge_${unique}`,
    from_offset: 0,
  })).data;
  const eventsResponse = (await axios.get(`${baseUrl}/v1/streams/eeoc_filings/events`, {
    params: { cursor_id: cursor.cursor_id, limit: 50 },
  })).data;
  const events = eventsResponse.events || [];
  if (!events.length) throw new Error('Expected at least one EEOC signal event from stream readback.');

  const offsets = events.map((event) => Number(event.offset));
  const fromOffset = Math.min(...offsets);
  const toOffset = Math.max(...offsets);

  const investigation = (await axios.post(`${baseUrl}/internal/investigations/run`, {
    trigger: { stream_id: 'eeoc_filings', cursor_id: cursor.cursor_id, from_offset: fromOffset, to_offset: toOffset },
  })).data;

  const bridgeResults = investigation.result?.bridge_results || [];
  const bridged = bridgeResults.find((result) => result.bridged);
  if (!bridged) throw new Error(`Expected a bridged prime pattern, got ${JSON.stringify(bridgeResults)}`);

  const result = {
    ok: true,
    health,
    ingest,
    event_count: events.length,
    investigation_job_id: investigation.job_id,
    emitted_patterns: investigation.result?.emitted_patterns,
    bridged,
  };

  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/official-bridge-cycle.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, response: error.response?.data }, null, 2));
  process.exit(1);
});

import axios from 'axios';
import fs from 'node:fs/promises';

const baseUrl = process.env.ATLAS_API_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
const now = new Date().toISOString();

const ingestBody = {
  source_id: 'open_states',
  jurisdiction_id: 'us_states',
  module_hint: 'legislative',
  signals: [
    {
      signal_type: 'open_states.bill',
      timestamp: now,
      spacetime: { jurisdiction: 'ocd-jurisdiction/country:us/state:ca/government', session: '2025-2026' },
      provenance: { channel: 'internal', source_system: 'atlas_test', confidence: 0.91 },
      payload: { external_id: `atlas-e2e-${Date.now()}-1`, title: 'Atlas e2e high confidence bill signal' },
    },
    {
      signal_type: 'open_states.bill',
      timestamp: now,
      spacetime: { jurisdiction: 'ocd-jurisdiction/country:us/state:ca/government', session: '2025-2026' },
      provenance: { channel: 'internal', source_system: 'atlas_test', confidence: 0.28 },
      payload: { external_id: `atlas-e2e-${Date.now()}-2`, title: 'Atlas e2e low confidence bill signal' },
    },
  ],
};

async function main() {
  const health = (await axios.get(`${baseUrl}/health`)).data;
  const ingest = (await axios.post(`${baseUrl}/v1/ingest/signals`, ingestBody)).data;
  const cursor = (await axios.post(`${baseUrl}/v1/streams/open_states/cursors`, { name: `e2e_${Date.now()}`, from_offset: 0 })).data;
  const eventsResponse = (await axios.get(`${baseUrl}/v1/streams/open_states/events`, { params: { cursor_id: cursor.cursor_id, limit: 20 } })).data;
  const events = eventsResponse.events || [];
  if (!events.length) throw new Error('Expected at least one event from stream readback.');
  const offsets = events.map((event) => Number(event.offset));
  const fromOffset = Math.min(...offsets);
  const toOffset = Math.max(...offsets);
  const investigation = (await axios.post(`${baseUrl}/internal/investigations/run`, {
    trigger: { stream_id: 'open_states', cursor_id: cursor.cursor_id, from_offset: fromOffset, to_offset: toOffset },
  })).data;
  const patterns = (await axios.get(`${baseUrl}/v1/patterns/prime`, { params: { module: 'legislative', jurisdiction: 'us_states', since: new Date(Date.now() - 3600_000).toISOString() } })).data;

  const result = {
    ok: true,
    health,
    ingest,
    cursor_id: cursor.cursor_id,
    readback_event_count: events.length,
    investigation_job_id: investigation.job_id,
    investigation_status: investigation.status,
    emitted_patterns: investigation.result?.emitted_patterns ?? 0,
    queried_pattern_count: patterns.patterns?.length ?? 0,
    newest_pattern: patterns.patterns?.[0] ?? null,
  };

  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/e2e-cycle.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, response: error.response?.data }, null, 2));
  process.exit(1);
});

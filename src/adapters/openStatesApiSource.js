import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ATLAS_API_BASE_URL = process.env.ATLAS_API_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;
const OPENSTATES_API_KEY = process.env.OPENSTATES_API_KEY;

export function normalizeOpenStatesBill(bill) {
  const updatedAt = bill.updated_at || bill.created_at || new Date().toISOString();
  const jurisdiction = bill.jurisdiction?.id || bill.jurisdiction?.name || bill.jurisdiction || 'us_states';
  const confidence = bill.latest_action_date ? 0.84 : 0.72;

  return {
    signal_type: 'open_states.bill',
    timestamp: new Date(updatedAt).toISOString(),
    spacetime: {
      jurisdiction,
      session: bill.session || null,
      chamber: bill.from_organization?.classification || null,
    },
    provenance: {
      channel: 'external',
      source_system: 'open_states',
      confidence,
      source_url: bill.openstates_url || bill.sources?.[0]?.url || null,
    },
    payload: {
      external_id: bill.id,
      identifier: bill.identifier,
      title: bill.title,
      classification: bill.classification || [],
      subjects: bill.subject || [],
      latest_action_date: bill.latest_action_date || null,
      latest_action_description: bill.latest_action_description || null,
      openstates_url: bill.openstates_url || null,
      raw: bill,
    },
  };
}

export async function ingestOpenStatesSignals({ signals, apiBaseUrl = ATLAS_API_BASE_URL } = {}) {
  const body = {
    source_id: 'open_states',
    jurisdiction_id: 'us_states',
    module_hint: 'legislative',
    signals,
  };

  const response = await axios.post(`${apiBaseUrl}/v1/ingest/signals`, body, { timeout: 15000 });
  return response.data;
}

export async function fetchOpenStatesBills({ jurisdiction = 'ca', first = 5 } = {}) {
  if (!OPENSTATES_API_KEY) {
    throw new Error('OPENSTATES_API_KEY is required for live OpenStates API fetches. Use --sample for local verification without the external API.');
  }

  const query = `
    query Bills($jurisdiction: String!, $first: Int!) {
      bills(jurisdiction: $jurisdiction, first: $first) {
        edges {
          node {
            id
            identifier
            title
            classification
            subject
            session
            updatedAt
            createdAt
            openstatesUrl
            latestActionDate
            latestActionDescription
            jurisdiction { id name }
            fromOrganization { classification name }
            sources { url }
          }
        }
      }
    }
  `;

  const response = await axios.post(
    'https://v3.openstates.org/graphql',
    { query, variables: { jurisdiction, first } },
    { headers: { 'X-API-KEY': OPENSTATES_API_KEY }, timeout: 20000 },
  );

  const edges = response.data?.data?.bills?.edges || [];
  return edges.map((edge) => edge.node).map((node) => ({
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    classification: node.classification,
    subject: node.subject,
    session: node.session,
    updated_at: node.updatedAt,
    created_at: node.createdAt,
    openstates_url: node.openstatesUrl,
    latest_action_date: node.latestActionDate,
    latest_action_description: node.latestActionDescription,
    jurisdiction: node.jurisdiction,
    from_organization: node.fromOrganization,
    sources: node.sources,
  }));
}

function sampleBills() {
  return [
    {
      id: 'ocd-bill/sample-atlas-1',
      identifier: 'AB 1001',
      title: 'Sample Atlas legislative signal for stream validation',
      classification: ['bill'],
      subject: ['technology'],
      session: '2025-2026',
      updated_at: new Date().toISOString(),
      latest_action_date: new Date().toISOString().slice(0, 10),
      latest_action_description: 'Referred to committee',
      jurisdiction: { id: 'ocd-jurisdiction/country:us/state:ca/government', name: 'California' },
      from_organization: { classification: 'lower', name: 'Assembly' },
      sources: [{ url: 'https://openstates.org/sample/atlas-1' }],
    },
    {
      id: 'ocd-bill/sample-atlas-2',
      identifier: 'SB 2002',
      title: 'Sample Atlas low-confidence legislative signal',
      classification: ['bill'],
      subject: ['budget'],
      session: '2025-2026',
      updated_at: new Date().toISOString(),
      latest_action_date: null,
      latest_action_description: 'Introduced',
      jurisdiction: { id: 'ocd-jurisdiction/country:us/state:ny/government', name: 'New York' },
      from_organization: { classification: 'upper', name: 'Senate' },
      sources: [{ url: 'https://openstates.org/sample/atlas-2' }],
    },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const useSample = process.argv.includes('--sample');
  const bills = useSample ? sampleBills() : await fetchOpenStatesBills({ first: 5 });
  const signals = bills.map(normalizeOpenStatesBill);
  const result = await ingestOpenStatesSignals({ signals });
  console.log(JSON.stringify({ ok: true, source: 'open_states', mode: useSample ? 'sample' : 'live', result }, null, 2));
}

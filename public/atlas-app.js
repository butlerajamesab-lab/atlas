const view = document.getElementById('view');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');

let overviewCache = null;
let legislativeCache = null;
let contractsCache = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactHash(value) {
  const text = String(value ?? '');
  if (!text) return '—';
  return text.length > 18 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}

function number(value) {
  return Number(value ?? 0).toLocaleString();
}

function badge(value) {
  const normalized = String(value ?? 'unknown').toLowerCase();
  const kind = ['ready','verified'].includes(normalized)
    ? normalized
    : normalized === 'verified_with_findings'
      ? 'verified_with_findings'
      : normalized.includes('fail') || normalized === 'blocked'
        ? 'failed'
        : normalized === 'degraded'
          ? 'degraded'
          : normalized === 'not_active'
            ? 'not_active'
            : 'unknown';
  return `<span class="badge badge-${kind}">${esc(value ?? 'unknown')}</span>`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.details || payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

function setConnection(ok) {
  connectionDot.className = `status-dot ${ok ? 'live' : 'error'}`;
  connectionText.textContent = ok ? 'LIVE READ MODEL' : 'READ MODEL ERROR';
}

function pageHeader(eyebrow, title, description, receipt = '') {
  return `<header class="page-header">
    <div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
    ${receipt ? `<div class="receipt-tag">${esc(receipt)}</div>` : ''}
  </header>`;
}

function metrics(items) {
  return `<section class="metrics">${items.map((item) => `<article class="metric"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.note)}</small></article>`).join('')}</section>`;
}

function sourceRows(sources, query = '') {
  const needle = query.trim().toLowerCase();
  const rows = sources.filter((row) => !needle || [row.source_name,row.adapter_class,row.operational_readiness_state,row.schema_name].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  return rows.map((row) => `<tr>
    <td><strong>${esc(row.source_name)}</strong></td>
    <td>${esc(row.adapter_class)}</td>
    <td>${badge(row.operational_readiness_state)}</td>
    <td>${esc(row.health_status ?? '—')}</td>
    <td>${esc(row.freshness_status ?? '—')}</td>
    <td>${esc(row.schema_status ?? '—')}</td>
    <td>${row.health_observed_at ? esc(new Date(row.health_observed_at).toLocaleString()) : '—'}</td>
  </tr>`).join('');
}

async function renderOverview() {
  overviewCache ??= await getJson('/ui-api/overview');
  const data = overviewCache;
  setConnection(true);
  const readiness = data.source_readiness;
  view.innerHTML = `${pageHeader('ATLAS / OPERATING SURFACE','Observe the machine.','Atlas exposes source readiness, governed streams, deterministic spaces, structural lenses, and replayable observations without converting correlation into interpretation.', data.read_model_version)}
    ${metrics([
      { label:'Streams', value:number(data.counts.active_streams), note:`${data.counts.streams} registered` },
      { label:'Signal Events', value:number(data.counts.signal_events), note:'canonical observations' },
      { label:'Legislative Versions', value:number(data.counts.legislative_version_observations), note:'governed bill generations' },
      { label:'Sources', value:number(data.counts.sources), note:'registered source bindings' },
      { label:'Ready / Degraded', value:`${readiness.ready} / ${readiness.degraded}`, note:`${readiness.unknown} unknown · ${readiness.not_active} inactive` },
    ])}
    <div class="grid-2">
      <section class="panel"><div class="panel-header"><div><div class="eyebrow">SOURCE READINESS</div><h2>Declared, not assumed</h2></div><small>health / freshness / schema</small></div><div class="panel-body readiness-stack">
        ${data.sources.filter((row) => row.connector_active).slice(0,12).map((row) => `<div class="readiness-row"><div><strong>${esc(row.source_name)}</strong><small>${esc(row.adapter_class)}${row.health_observed_at ? ` · ${esc(new Date(row.health_observed_at).toLocaleDateString())}` : ''}</small></div>${badge(row.operational_readiness_state)}</div>`).join('')}
      </div></section>
      <section class="panel"><div class="panel-header"><div><div class="eyebrow">ACTIVE STREAMS</div><h2>Signal universe</h2></div><small>${number(data.counts.active_streams)} live contracts</small></div><div class="panel-body"><div class="stream-list">
        ${data.streams.filter((row) => row.status === 'active').slice(0,14).map((row) => `<div class="stream-card"><strong>${esc(row.stream_id)}</strong><small>${esc(row.jurisdiction_id)} · ${esc(row.module_hint)}</small></div>`).join('')}
      </div></div></section>
    </div>
    <div class="section-note"><strong>Current rule:</strong> absence remains absence. Unknown source health is displayed as unknown; it is not converted into a neutral score. Atlas records what is observed, how it was normalized, and what deterministic computation produced a result.</div>`;
}

async function renderSources() {
  overviewCache ??= await getJson('/ui-api/overview');
  const data = overviewCache;
  setConnection(true);
  view.innerHTML = `${pageHeader('SOURCE REGISTRY','Source readiness & adapters','Every source enters through a declared connector and schema authority. Health, freshness, schema state, and fallback availability are observable independently.', data.read_model_version)}
    ${metrics([
      {label:'Registered',value:number(data.counts.sources),note:'canonical connector bindings'},
      {label:'Ready',value:number(data.source_readiness.ready),note:'all readiness gates satisfied'},
      {label:'Degraded',value:number(data.source_readiness.degraded),note:'usable with explicit limitation'},
      {label:'Unknown',value:number(data.source_readiness.unknown),note:'health not yet proven'},
      {label:'Inactive',value:number(data.source_readiness.not_active),note:'declared but not running'},
    ])}
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">REGISTRY</div><h2>Canonical source bindings</h2></div><small>No credentials exposed</small></div><div class="panel-body">
      <div class="source-toolbar"><input id="sourceSearch" class="input" placeholder="Filter by source, adapter, schema, or readiness…" /></div>
      <div class="table-scroll"><table class="source-table"><thead><tr><th>Source</th><th>Adapter</th><th>Readiness</th><th>Health</th><th>Freshness</th><th>Schema</th><th>Observed</th></tr></thead><tbody id="sourceBody">${sourceRows(data.sources)}</tbody></table></div>
    </div></section>`;
  document.getElementById('sourceSearch').addEventListener('input', (event) => {
    document.getElementById('sourceBody').innerHTML = sourceRows(data.sources, event.target.value);
  });
}

function stateBadgeClass(state) {
  if (state === 'verified') return 'verified';
  if (state === 'verified_with_findings') return 'verified_with_findings';
  if (state === 'failed') return 'failed';
  return 'unknown';
}

async function renderLegislative() {
  legislativeCache ??= await getJson('/ui-api/legislative-history?limit=100');
  const data = legislativeCache;
  setConnection(true);
  const observations = data.observations;
  const first = observations[0]?.payload?.version;
  const sourceBillId = first?.source_bill_id ?? '—';
  const familyId = observations[0]?.payload?.family_id ?? '—';
  view.innerHTML = `${pageHeader('DOCUMENT LINEAGE','Legislative history as a governed space','Each node is one canonical Civic Genome bill version. Failed amendments remain first-class history. Source-native Prism/Rosetta states are preserved rather than collapsed, and Atlas does not infer legislative consequence here.', data.read_model_version)}
    ${metrics([
      {label:'Bill',value:String(sourceBillId),note:'source bill identity'},
      {label:'Versions',value:number(data.observation_count),note:'one observation per generation'},
      {label:'Verified',value:number(data.processing_state_counts.verified),note:'source-bound'},
      {label:'With Findings',value:number(data.processing_state_counts.verified_with_findings),note:'verification findings preserved'},
      {label:'Failed',value:number(data.processing_state_counts.failed),note:'failed amendments retained'},
    ])}
    <div class="section-note"><strong>Family:</strong> <span style="font-family:var(--mono)">${esc(familyId)}</span><br>${esc(data.semantics)}</div>
    <div class="timeline-summary">${Object.entries(data.processing_state_counts).map(([key,value]) => `<span class="badge badge-${stateBadgeClass(key)}">${esc(key)} ${number(value)}</span>`).join('')}</div>
    <section class="timeline">
      ${observations.map((row, index) => {
        const version = row.payload?.version ?? {};
        const traits = row.payload?.structural_traits ?? {};
        const state = version.processing_state ?? 'unknown';
        const prism = traits.prism_state_counts ?? {};
        const traitClasses = traits.trait_class_counts ?? {};
        return `<article class="version-card ${state === 'failed' ? 'failed' : state === 'verified' ? 'verified' : ''}">
          <div class="version-top"><div><div class="version-order">${String(index + 1).padStart(2,'0')} · STAGE ${esc(version.stage_rank ?? '—')} · SEQUENCE ${esc(version.provider_sequence ?? '—')}</div><h3>${esc(String(version.version_type ?? 'unknown').replaceAll('_',' '))}</h3></div>${badge(state)}</div>
          <div class="version-meta"><span>${esc(version.source_document_key ?? 'no source key')}</span><span>run ${esc(version.rosetta_extraction_run_id ?? '—')}</span><span>${compactHash(row.event_identity_hash)}</span></div>
          <div class="version-details">
            <div class="detail-chip"><span>Traits</span><strong>${number(traits.trait_count)}</strong></div>
            <div class="detail-chip"><span>Prism supported</span><strong>${number(prism.supported_by_one_source)}</strong></div>
            <div class="detail-chip"><span>Prism contradicted</span><strong>${number(prism.contradicted)}</strong></div>
            <div class="detail-chip"><span>Layers observed</span><strong>${Object.keys(traitClasses).length}</strong></div>
          </div>
          ${version.failure_code ? `<div class="failure-box">${esc(version.failure_code)}</div>` : ''}
        </article>`;
      }).join('')}
    </section>`;
}

async function renderContracts() {
  contractsCache ??= await getJson('/ui-api/contracts');
  const data = contractsCache;
  setConnection(true);
  view.innerHTML = `${pageHeader('INVARIANT ENGINE','Spaces, filters & structural lenses','Domains supply coordinates, adapters, filters, and lenses. They do not alter the mathematical core. The same engine can operate across geography, networks, process topology, document lineage, and registered continuous parameter spaces.', data.read_model_version)}
    <section class="contract-grid">
      <article class="contract-card"><h3>Domain spaces</h3><p>Registered deterministic comparison rules. Non-geographic domains must declare their space explicitly.</p><div class="contract-list">${data.domain_space_rules.map((rule) => `<div class="contract-item"><strong>${esc(rule.rule_id)}</strong><small>${esc(rule.allowed_space_types.join(' · '))} · v${esc(rule.rule_version)}</small></div>`).join('')}</div></article>
      <article class="contract-card"><h3>Filter stack</h3><p>Requested scope composes with governed and hardened integrity filters. Hardened filters cannot be removed.</p><div class="contract-list">${data.filters.map((filter) => `<div class="contract-item"><strong>${esc(filter.filter_id)}</strong><small>${esc(filter.filter_category)} · ${esc(filter.permission_level)}</small></div>`).join('')}</div></article>
      <article class="contract-card"><h3>Structural lenses</h3><p>Patterns are lenses, not boxes. Atlas records structural matches without claiming downstream consequence.</p><div class="contract-list">${data.structural_lenses.map((lens) => `<div class="contract-item"><strong>${esc(lens.lens_id)}</strong><small>${esc(lens.description)}</small></div>`).join('')}</div></article>
    </section>
    <div class="section-note"><strong>Module contract:</strong> ${esc(data.module_contract_version)} · <strong>Filter registry:</strong> ${esc(data.filter_registry_version)} · <strong>Lens registry:</strong> ${esc(data.structural_lens_registry_version)}</div>`;
}

async function renderBoundary() {
  contractsCache ??= await getJson('/ui-api/contracts');
  const boundary = contractsCache.ownership_boundary;
  setConnection(true);
  const order = ['docket','rosetta','civic_genome','atlas','prism','kaleidoscope','lighthouse'];
  view.innerHTML = `${pageHeader('OPERATING CONSTITUTION','Ownership stays where truth originates.','Atlas may bind governed identities from other platforms, but it cannot silently take ownership of their canonical fields.', contractsCache.read_model_version)}
    <div class="boundary-flow">${order.map((key) => `<div class="boundary-node ${key === 'atlas' ? 'atlas' : ''}"><strong>${esc(key.replace('_',' ').toUpperCase())}</strong><p>${esc(boundary[key])}</p></div>`).join('')}</div>
    <div class="boundary-rule">SOURCE → NORMALIZE → OBSERVE → RELATE → CONVERGE → RECEIPT<br><br>Atlas stops before legal interpretation, verification ownership, consequence projection, or action dispatch. Every governed computation must remain replayable from declared source identity, rules, filters, domain space, engine version, and complete output hash.</div>`;
}

const renderers = {
  overview: renderOverview,
  sources: renderSources,
  legislative: renderLegislative,
  contracts: renderContracts,
  boundary: renderBoundary,
};

async function navigate(name) {
  const target = renderers[name] ? name : 'overview';
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === target));
  view.innerHTML = `<div class="loading-screen"><div class="loading-orbit"><i></i></div><div>Loading Atlas receipts…</div></div>`;
  try {
    await renderers[target]();
    history.replaceState(null, '', `#${target}`);
  } catch (error) {
    setConnection(false);
    view.innerHTML = `<div class="error-panel"><strong>Atlas read surface failed.</strong><br>${esc(error.message)}</div>`;
  }
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
navigate(location.hash.slice(1) || 'overview');

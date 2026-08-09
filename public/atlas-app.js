const view = document.getElementById('view');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');
const refreshButton = document.getElementById('refreshButton');
const operatorButton = document.getElementById('operatorButton');
const operatorDialog = document.getElementById('operatorDialog');
const operatorForm = document.getElementById('operatorForm');
const operatorTokenInput = document.getElementById('operatorToken');
const operatorError = document.getElementById('operatorError');
const toast = document.getElementById('toast');

let currentView = 'overview';
let operatorToken = '';
let toastTimer = null;

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

function dateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function percent(part, total) {
  const denominator = Number(total ?? 0);
  if (denominator <= 0) return '0%';
  return `${((Number(part ?? 0) / denominator) * 100).toFixed(1)}%`;
}

function badge(value) {
  const normalized = String(value ?? 'unknown').toLowerCase();
  const kind = ['ready','verified','active','completed','ok','productive'].includes(normalized)
    ? 'verified'
    : normalized === 'verified_with_findings'
      ? 'verified_with_findings'
      : normalized.includes('fail') || normalized === 'blocked' || normalized === 'quarantined'
        ? 'failed'
        : ['degraded','unexpectedly_zero','paused','skipped'].includes(normalized)
          ? 'degraded'
          : normalized === 'not_active'
            ? 'not_active'
            : 'unknown';
  return `<span class="badge badge-${kind}">${esc(value ?? 'unknown')}</span>`;
}

async function requestJson(url, { operator = false, method = 'GET', body = undefined, token = null } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const bearer = token ?? (operator ? operatorToken : '');
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.details || payload.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setConnection(ok, observedAt = null) {
  connectionDot.className = `status-dot ${ok ? 'live' : 'error'}`;
  connectionText.textContent = ok
    ? `LIVE · ${observedAt ? new Date(observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW'}`
    : 'READ MODEL ERROR';
}

function showToast(message, kind = 'ok') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${kind}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 7000);
}

function pageHeader(eyebrow, title, description, receipt = '', observedAt = null) {
  return `<header class="page-header">
    <div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
    <div class="header-receipts">
      ${receipt ? `<div class="receipt-tag">${esc(receipt)}</div>` : ''}
      ${observedAt ? `<small>Observed ${esc(dateTime(observedAt))}</small>` : ''}
    </div>
  </header>`;
}

function metrics(items) {
  return `<section class="metrics">${items.map((item) => `<article class="metric"><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong><small>${esc(item.note)}</small></article>`).join('')}</section>`;
}

function actionButton(label, attributes = '', kind = '') {
  return `<button class="button small ${kind}" type="button" ${attributes}>${esc(label)}</button>`;
}

function openOperatorDialog() {
  operatorError.hidden = true;
  operatorError.textContent = '';
  operatorTokenInput.value = '';
  operatorDialog.showModal();
  setTimeout(() => operatorTokenInput.focus(), 0);
}

function requireOperator() {
  if (operatorToken) return true;
  openOperatorDialog();
  return false;
}

function sourceRows(sources, query = '') {
  const needle = query.trim().toLowerCase();
  const rows = sources
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !needle || [row.source_name,row.adapter_class,row.operational_readiness_state,row.schema_name].some((value) => String(value ?? '').toLowerCase().includes(needle)));
  return rows.map(({ row, index }) => `<tr>
    <td><strong>${esc(row.source_name)}</strong></td>
    <td>${esc(row.adapter_class)}</td>
    <td>${badge(row.operational_readiness_state)}</td>
    <td>${esc(row.health_status ?? '—')}</td>
    <td>${esc(row.freshness_status ?? '—')}</td>
    <td>${esc(row.schema_status ?? '—')}</td>
    <td>${dateTime(row.health_observed_at)}</td>
    <td>${actionButton('Inspect', `data-source-index="${index}"`, 'secondary')}</td>
  </tr>`).join('');
}

function sourceDetail(row) {
  return `<div class="detail-grid">
    <div><span>Source</span><strong>${esc(row.source_name)}</strong></div>
    <div><span>Connector</span><strong>${compactHash(row.connector_id)}</strong></div>
    <div><span>Adapter</span><strong>${esc(row.adapter_class)}</strong></div>
    <div><span>Schema</span><strong>${esc(row.schema_name)} · ${esc(row.schema_version ?? '—')}</strong></div>
    <div><span>Health</span><strong>${esc(row.health_status ?? 'unobserved')}</strong></div>
    <div><span>Freshness</span><strong>${esc(row.freshness_status ?? 'unobserved')}</strong></div>
    <div><span>Schema state</span><strong>${esc(row.schema_status ?? 'unobserved')}</strong></div>
    <div><span>Records observed</span><strong>${number(row.records_observed)}</strong></div>
  </div>`;
}

async function renderOverview() {
  const data = await requestJson('/ui-api/overview');
  setConnection(true, data.observed_at);
  const readiness = data.source_readiness;
  view.innerHTML = `${pageHeader('ATLAS / OPERATING SURFACE','Observe and operate the machine.','Every number below is retrieved from the Atlas read model. Registered, runnable, producing, healthy, and verified remain separate states.', data.read_model_version, data.observed_at)}
    ${metrics([
      { label:'Stream Contracts', value:number(data.counts.active_streams), note:`${data.counts.runnable_streams} runnable · ${data.counts.producing_streams} producing` },
      { label:'Signal Events', value:number(data.counts.signal_events), note:`${percent(data.counts.identity_bound_events, data.counts.signal_events)} identity-bound` },
      { label:'Signal Types', value:number(data.counts.signal_types), note:`latest ${dateTime(data.latest_signal_at)}` },
      { label:'Deterministic Patterns', value:number(data.counts.prime_patterns), note:`${number(data.counts.investigative_jobs)} investigation jobs` },
      { label:'Ready / Degraded', value:`${readiness.ready} / ${readiness.degraded}`, note:`${readiness.unknown} unknown · ${readiness.not_active} inactive` },
    ])}
    <div class="grid-2">
      <section class="panel"><div class="panel-header"><div><div class="eyebrow">SOURCE READINESS</div><h2>Declared, not assumed</h2></div>${actionButton('Open registry','data-go-view="sources"','secondary')}</div><div class="panel-body readiness-stack">
        ${data.sources.filter((row) => row.connector_active).slice(0,12).map((row) => `<div class="readiness-row"><div><strong>${esc(row.source_name)}</strong><small>${esc(row.adapter_class)}${row.health_observed_at ? ` · ${esc(new Date(row.health_observed_at).toLocaleDateString())}` : ''}</small></div>${badge(row.operational_readiness_state)}</div>`).join('')}
      </div></section>
      <section class="panel"><div class="panel-header"><div><div class="eyebrow">STREAM RUNTIME</div><h2>Contracts versus production</h2></div>${actionButton('Open streams','data-go-view="streams"','secondary')}</div><div class="panel-body"><div class="stream-list">
        ${data.streams.slice(0,14).map((row) => `<button class="stream-card interactive" data-go-view="streams" type="button"><strong>${esc(row.stream_id)}</strong><small>${number(row.event_count)} events · ${row.runnable ? 'runnable' : 'no runtime adapter'}</small></button>`).join('')}
      </div></div></section>
    </div>
    <div class="section-note"><strong>Observed state:</strong> ${number(data.counts.zero_event_streams)} registered streams currently contain zero signal events. That is shown as absence, not success and not failure. Run receipts and adapter errors are available under Operations.</div>`;
  bindNavigationActions();
}

async function renderSources() {
  const data = await requestJson('/ui-api/overview');
  setConnection(true, data.observed_at);
  view.innerHTML = `${pageHeader('SOURCE REGISTRY','Source readiness & adapters','Canonical connector and schema bindings with independently observed health, freshness, and schema state.', data.read_model_version, data.observed_at)}
    ${metrics([
      {label:'Registered',value:number(data.counts.sources),note:'canonical connector bindings'},
      {label:'Ready',value:number(data.source_readiness.ready),note:'all readiness gates satisfied'},
      {label:'Degraded',value:number(data.source_readiness.degraded),note:'usable with explicit limitation'},
      {label:'Unknown',value:number(data.source_readiness.unknown),note:'health not yet proven'},
      {label:'Inactive',value:number(data.source_readiness.not_active),note:'declared but not running'},
    ])}
    <section id="sourceDetail" class="panel detail-panel" hidden></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">REGISTRY</div><h2>Canonical source bindings</h2></div><small>No credentials exposed</small></div><div class="panel-body">
      <div class="source-toolbar"><input id="sourceSearch" class="input" placeholder="Filter by source, adapter, schema, or readiness…" />${operatorToken ? actionButton('Reconcile health','data-reconcile-health') : actionButton('Unlock to reconcile','data-unlock','secondary')}</div>
      <div class="table-scroll"><table class="source-table"><thead><tr><th>Source</th><th>Adapter</th><th>Readiness</th><th>Health</th><th>Freshness</th><th>Schema</th><th>Observed</th><th></th></tr></thead><tbody id="sourceBody">${sourceRows(data.sources)}</tbody></table></div>
    </div></section>`;
  const bindSourceRows = () => {
    document.querySelectorAll('[data-source-index]').forEach((button) => button.addEventListener('click', () => {
      const row = data.sources[Number(button.dataset.sourceIndex)];
      const detail = document.getElementById('sourceDetail');
      detail.hidden = false;
      detail.innerHTML = `<div class="panel-header"><div><div class="eyebrow">SOURCE RECEIPT</div><h2>${esc(row.source_name)}</h2></div>${badge(row.operational_readiness_state)}</div><div class="panel-body">${sourceDetail(row)}</div>`;
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  };
  bindSourceRows();
  document.getElementById('sourceSearch').addEventListener('input', (event) => {
    document.getElementById('sourceBody').innerHTML = sourceRows(data.sources, event.target.value);
    bindSourceRows();
  });
  bindOperatorActions();
}

function streamDetail(row) {
  return `<div class="detail-grid">
    <div><span>Contract status</span><strong>${esc(row.status)}</strong></div>
    <div><span>Runtime adapter</span><strong>${esc(row.adapter_name ?? 'not compiled')}</strong></div>
    <div><span>Event count</span><strong>${number(row.event_count)}</strong></div>
    <div><span>Identity coverage</span><strong>${percent(row.identity_count, row.event_count)}</strong></div>
    <div><span>Signal types</span><strong>${number(row.signal_type_count)}</strong></div>
    <div><span>Latest event</span><strong>${dateTime(row.latest_event_at)}</strong></div>
    <div><span>Jurisdiction</span><strong>${esc(row.jurisdiction_id)}</strong></div>
    <div><span>Module</span><strong>${esc(row.module_hint)}</strong></div>
    <div><span>Governance contract</span><strong>${esc(row.governance_contract_id)}</strong></div>
  </div>
  <div class="detail-actions">
    ${row.runnable ? actionButton('Run now',`data-run-adapter="${esc(row.adapter_name)}" data-stream-id="${esc(row.stream_id)}"`) : ''}
    ${row.status === 'active' ? actionButton('Pause',`data-stream-status="paused" data-stream-id="${esc(row.stream_id)}"`,'secondary') : actionButton('Activate',`data-stream-status="active" data-stream-id="${esc(row.stream_id)}"`,'secondary')}
    ${actionButton('Quarantine',`data-stream-status="quarantined" data-stream-id="${esc(row.stream_id)}"`,'danger')}
  </div>`;
}

async function renderStreams() {
  const data = await requestJson('/ui-api/streams');
  const streams = data.streams;
  setConnection(true, data.observed_at);
  const runnable = streams.filter((row) => row.runnable).length;
  const producing = streams.filter((row) => Number(row.event_count) > 0).length;
  const zero = streams.filter((row) => Number(row.event_count) === 0).length;
  const unavailable = streams.filter((row) => !row.runnable).length;
  view.innerHTML = `${pageHeader('STREAM CONTROL','Every stream state, separately.','Inspect contract registration, runtime availability, canonical event production, identity coverage, and the latest observation. Operator actions produce persistent receipts.', data.read_model_version, data.observed_at)}
    ${metrics([
      {label:'Registered',value:number(streams.length),note:'database contracts'},
      {label:'Runnable',value:number(runnable),note:'compiled adapters'},
      {label:'Producing',value:number(producing),note:'one or more events'},
      {label:'Zero Events',value:number(zero),note:'absence retained'},
      {label:'No Runtime',value:number(unavailable),note:'declared only'},
    ])}
    <div class="section-note">${esc(data.semantics)}</div>
    <section id="streamDetail" class="panel detail-panel" hidden></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">RUNTIME MATRIX</div><h2>Stream contracts and production</h2></div>${operatorToken ? badge('operator unlocked') : actionButton('Unlock controls','data-unlock','secondary')}</div><div class="panel-body">
      <div class="source-toolbar"><input id="streamSearch" class="input" placeholder="Filter by stream, source, jurisdiction, module, or status…" /></div>
      <div class="table-scroll"><table class="source-table"><thead><tr><th>Stream</th><th>Status</th><th>Runtime</th><th>Events</th><th>Identity</th><th>Latest event</th><th></th></tr></thead><tbody id="streamBody"></tbody></table></div>
    </div></section>`;
  const renderRows = (query = '') => {
    const needle = query.trim().toLowerCase();
    const filtered = streams.filter((row) => !needle || [row.stream_id,row.source_id,row.jurisdiction_id,row.module_hint,row.status,row.adapter_name].some((value) => String(value ?? '').toLowerCase().includes(needle)));
    document.getElementById('streamBody').innerHTML = filtered.map((row) => `<tr>
      <td><strong>${esc(row.stream_id)}</strong><small>${esc(row.module_hint)}</small></td>
      <td>${badge(row.status)}</td>
      <td>${row.runnable ? badge('runnable') : badge('declared only')}</td>
      <td>${number(row.event_count)}</td>
      <td>${percent(row.identity_count,row.event_count)}</td>
      <td>${dateTime(row.latest_event_at)}</td>
      <td>${actionButton('Inspect',`data-inspect-stream="${esc(row.stream_id)}"`,'secondary')}</td>
    </tr>`).join('');
    document.querySelectorAll('[data-inspect-stream]').forEach((button) => button.addEventListener('click', () => {
      const row = streams.find((candidate) => candidate.stream_id === button.dataset.inspectStream);
      const detail = document.getElementById('streamDetail');
      detail.hidden = false;
      detail.innerHTML = `<div class="panel-header"><div><div class="eyebrow">STREAM RECEIPT</div><h2>${esc(row.stream_id)}</h2></div>${badge(row.runnable ? 'runnable' : 'declared only')}</div><div class="panel-body">${streamDetail(row)}</div>`;
      bindOperatorActions();
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  };
  renderRows();
  document.getElementById('streamSearch').addEventListener('input', (event) => renderRows(event.target.value));
  bindOperatorActions();
}

async function renderSubstrate() {
  const data = await requestJson('/ui-api/signal-substrate');
  const summary = data.summary;
  setConnection(true, summary.observed_at);
  view.innerHTML = `${pageHeader('SIGNAL SUBSTRATE','Observe what Atlas produced.','This surface shows canonical observations by stream and type, identity coverage, investigation activity, and persisted deterministic pattern counts.', data.read_model_version, summary.observed_at)}
    ${metrics([
      {label:'Signal Events',value:number(summary.signal_events),note:`${number(summary.producing_streams)} producing streams`},
      {label:'Identity Bound',value:percent(summary.identity_bound_events,summary.signal_events),note:`${number(summary.identity_bound_events)} events`},
      {label:'Signal Types',value:number(summary.signal_types),note:'observed classifications'},
      {label:'Prime Patterns',value:number(summary.prime_patterns),note:`latest ${dateTime(summary.latest_pattern_at)}`},
      {label:'Investigations',value:number(summary.investigative_jobs),note:`${number(summary.failed_investigative_jobs)} failed`},
    ])}
    <div class="section-note">${esc(data.semantics)}</div>
    <section id="deterministicOutput" class="panel detail-panel" hidden></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">DISTRIBUTION</div><h2>Observed signal types</h2></div>${operatorToken ? actionButton('Load deterministic outputs','data-load-outputs') : actionButton('Unlock pattern details','data-unlock','secondary')}</div><div class="panel-body">
      <div class="table-scroll"><table class="source-table"><thead><tr><th>Signal type</th><th>Stream</th><th>Module</th><th>Jurisdiction</th><th>Events</th><th>Identity</th><th>Latest</th></tr></thead><tbody>${data.signal_types.map((row) => `<tr><td><strong>${esc(row.signal_type)}</strong></td><td>${esc(row.stream_id)}</td><td>${esc(row.module_hint)}</td><td>${esc(row.jurisdiction_id)}</td><td>${number(row.event_count)}</td><td>${percent(row.identity_count,row.event_count)}</td><td>${dateTime(row.latest_event_at)}</td></tr>`).join('')}</tbody></table></div>
    </div></section>`;
  bindOperatorActions();
}

function stateBadgeClass(state) {
  if (state === 'verified') return 'verified';
  if (state === 'verified_with_findings') return 'verified_with_findings';
  if (state === 'failed') return 'failed';
  return 'unknown';
}

async function renderLegislative() {
  const data = await requestJson('/ui-api/legislative-history?limit=100');
  setConnection(true, new Date().toISOString());
  const observations = data.observations;
  const first = observations[0]?.payload?.version;
  const sourceBillId = first?.source_bill_id ?? '—';
  const familyId = observations[0]?.payload?.family_id ?? '—';
  view.innerHTML = `${pageHeader('DOCUMENT LINEAGE','Legislative history as a governed space','Each node is one canonical Civic Genome bill version. Failed amendments remain first-class history. Source-native Prism/Rosetta states are preserved rather than collapsed.', data.read_model_version)}
    ${metrics([
      {label:'Bill',value:String(sourceBillId),note:'source bill identity'},
      {label:'Versions',value:number(data.observation_count),note:'one observation per generation'},
      {label:'Verified',value:number(data.processing_state_counts.verified),note:'source-bound'},
      {label:'With Findings',value:number(data.processing_state_counts.verified_with_findings),note:'findings preserved'},
      {label:'Failed',value:number(data.processing_state_counts.failed),note:'failed amendments retained'},
    ])}
    <div class="section-note"><strong>Family:</strong> <span class="mono">${esc(familyId)}</span><br>${esc(data.semantics)}</div>
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
  const data = await requestJson('/ui-api/contracts');
  setConnection(true, new Date().toISOString());
  view.innerHTML = `${pageHeader('INVARIANT ENGINE','Spaces, filters & structural lenses','Domains supply coordinates, adapters, filters, and lenses. They do not alter the mathematical core.', data.read_model_version)}
    <section class="contract-grid">
      <article class="contract-card"><h3>Domain spaces</h3><p>Registered deterministic comparison rules. Non-geographic domains must declare their space explicitly.</p><div class="contract-list">${data.domain_space_rules.map((rule) => `<details class="contract-item"><summary>${esc(rule.rule_id)}</summary><small>${esc(rule.allowed_space_types.join(' · '))} · v${esc(rule.rule_version)}</small></details>`).join('')}</div></article>
      <article class="contract-card"><h3>Filter stack</h3><p>Requested scope composes with governed and hardened integrity filters. Hardened filters cannot be removed.</p><div class="contract-list">${data.filters.map((filter) => `<details class="contract-item"><summary>${esc(filter.filter_id)}</summary><small>${esc(filter.filter_category)} · ${esc(filter.permission_level)}${filter.description ? ` · ${esc(filter.description)}` : ''}</small></details>`).join('')}</div></article>
      <article class="contract-card"><h3>Structural lenses</h3><p>Patterns are lenses, not boxes. Atlas records structural matches without claiming downstream consequence.</p><div class="contract-list">${data.structural_lenses.map((lens) => `<details class="contract-item"><summary>${esc(lens.lens_id)}</summary><small>${esc(lens.description)}</small></details>`).join('')}</div></article>
    </section>
    <div class="section-note"><strong>Module contract:</strong> ${esc(data.module_contract_version)} · <strong>Filter registry:</strong> ${esc(data.filter_registry_version)} · <strong>Lens registry:</strong> ${esc(data.structural_lens_registry_version)}</div>`;
}

async function renderBoundary() {
  const data = await requestJson('/ui-api/contracts');
  const boundary = data.ownership_boundary;
  setConnection(true, new Date().toISOString());
  const order = ['docket','rosetta','civic_genome','atlas','prism','kaleidoscope','lighthouse'];
  view.innerHTML = `${pageHeader('OPERATING CONSTITUTION','Ownership stays where truth originates.','Atlas may bind governed identities from other platforms, but it cannot silently take ownership of their canonical fields.', data.read_model_version)}
    <div class="boundary-flow">${order.map((key) => `<details class="boundary-node ${key === 'atlas' ? 'atlas' : ''}"><summary>${esc(key.replace('_',' ').toUpperCase())}</summary><p>${esc(boundary[key])}</p></details>`).join('')}</div>
    <div class="boundary-rule">SOURCE → NORMALIZE → OBSERVE → RELATE → CONVERGE → RECEIPT<br><br>Atlas stops before legal interpretation, verification ownership, consequence projection, or action dispatch. Every governed computation must remain replayable from declared source identity, rules, filters, domain space, engine version, and complete output hash.</div>`;
}

function receiptRows(receipts) {
  return receipts.map((row) => `<tr><td>${dateTime(row.completed_at)}</td><td><strong>${esc(row.action_type)}</strong><small>${esc(row.target_id ?? '—')}</small></td><td>${badge(row.outcome_status)}</td><td>${row.event_delta === null || row.event_delta === undefined ? '—' : number(row.event_delta)}</td><td class="mono">${compactHash(row.action_receipt_hash)}</td></tr>`).join('');
}

async function renderOperations() {
  if (!operatorToken) {
    setConnection(true, new Date().toISOString());
    view.innerHTML = `${pageHeader('OPERATOR CONTROL','Controls are locked.','Read surfaces remain public-safe. Running adapters, changing stream state, registering compiled streams, and viewing restricted deterministic outputs require the Atlas control token.')}
      <section class="locked-panel"><div class="lock-mark">A</div><h2>Governed actions require authentication</h2><p>The token remains in memory only for this page session.</p>${actionButton('Unlock controls','data-unlock')}</section>`;
    bindOperatorActions();
    return;
  }
  const [status, streamsData] = await Promise.all([
    requestJson('/operator-api/status', { operator: true }),
    requestJson('/ui-api/streams'),
  ]);
  setConnection(true, status.observed_at);
  const adapters = status.scheduler.adapters;
  const failures = adapters.filter((row) => row.lastResult?.status === 'error').length;
  const zero = adapters.filter((row) => row.lastResult?.outcome === 'unexpectedly_zero').length;
  const running = adapters.filter((row) => row.running).length;
  const registered = new Set(streamsData.streams.map((row) => row.stream_id));
  const missing = adapters.filter((row) => row.stream_id && !registered.has(row.stream_id));
  view.innerHTML = `${pageHeader('OPERATOR CONTROL','Run, verify, and retain the receipt.','Every manual action returns a content hash and measured event delta. Adapter-reported counts are retained separately from canonical database deltas.', 'atlas.action_receipt.v1', status.observed_at)}
    ${metrics([
      {label:'Scheduler',value:status.scheduler.running ? 'RUNNING' : 'STOPPED',note:`started ${dateTime(status.scheduler.started_at)}`},
      {label:'Compiled Adapters',value:number(adapters.length),note:`${running} running now`},
      {label:'Last-run Failures',value:number(failures),note:'explicit runtime errors'},
      {label:'Unexpected Zero',value:number(zero),note:'completed without production'},
      {label:'Recent Receipts',value:number(status.recent_receipts.length),note:'latest governed actions'},
    ])}
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">ENGINE ACTIONS</div><h2>Deterministic production controls</h2></div>${badge('operator unlocked')}</div><div class="panel-body detail-actions">
      ${actionButton('Run signal detector','data-run-signals')}
      ${actionButton('Reconcile source health','data-reconcile-health','secondary')}
      ${actionButton('Refresh receipts','data-refresh-current','secondary')}
      ${actionButton('Lock controls','data-lock','danger')}
    </div></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">ADAPTER RUNTIME</div><h2>Compiled stream runners</h2></div><small>database delta is authoritative</small></div><div class="panel-body"><div class="table-scroll"><table class="source-table"><thead><tr><th>Adapter</th><th>Stream</th><th>Priority</th><th>Last run</th><th>Outcome</th><th>Delta</th><th></th></tr></thead><tbody>${adapters.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.stream_id ?? 'unbound')}</td><td>${esc(row.priority)}</td><td>${dateTime(row.lastRun)}</td><td>${badge(row.lastResult?.outcome ?? 'not run since start')}</td><td>${row.lastResult?.event_delta === undefined ? '—' : number(row.lastResult.event_delta)}</td><td>${row.stream_id ? actionButton('Run',`data-run-adapter="${esc(row.name)}" data-stream-id="${esc(row.stream_id)}"`) : ''}</td></tr>`).join('')}</tbody></table></div></div></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">STREAM REGISTRATION</div><h2>Add compiled streams</h2></div><small>${number(missing.length)} available</small></div><div class="panel-body">${missing.length ? `<form id="streamRegistrationForm" class="registration-form"><select id="registerAdapter" class="input" required>${missing.map((row) => `<option value="${esc(row.name)}" data-stream-id="${esc(row.stream_id)}">${esc(row.name)} → ${esc(row.stream_id)}</option>`).join('')}</select><input id="registerSource" class="input" placeholder="source_id" required /><input id="registerJurisdiction" class="input" placeholder="jurisdiction_id" required /><input id="registerModule" class="input" placeholder="module_hint" required /><select id="registerThroughput" class="input"><option>medium</option><option>low</option><option>high</option><option>ultra</option></select><select id="registerSafety" class="input"><option>default</option><option>restricted</option><option>critical</option></select><input id="registerGovernance" class="input" placeholder="governance_contract_id" required /><button class="button" type="submit">Register stream</button></form>` : '<div class="section-note">All compiled adapters already have registered stream contracts. A source that has no compiled adapter cannot be mislabeled as runnable from this UI.</div>'}</div></section>
    <section class="panel"><div class="panel-header"><div><div class="eyebrow">ACTION RECEIPTS</div><h2>Recent governed actions</h2></div><small>persistent · hash-bound</small></div><div class="panel-body"><div class="table-scroll"><table class="source-table"><thead><tr><th>Completed</th><th>Action</th><th>Outcome</th><th>Event delta</th><th>Receipt</th></tr></thead><tbody>${receiptRows(status.recent_receipts)}</tbody></table></div></div></section>`;
  bindOperatorActions();
  const form = document.getElementById('streamRegistrationForm');
  if (form) form.addEventListener('submit', registerStream);
}

const renderers = {
  overview: renderOverview,
  sources: renderSources,
  streams: renderStreams,
  substrate: renderSubstrate,
  legislative: renderLegislative,
  contracts: renderContracts,
  boundary: renderBoundary,
  operations: renderOperations,
};

async function navigate(name) {
  const target = renderers[name] ? name : 'overview';
  currentView = target;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === target));
  view.innerHTML = '<div class="loading-screen"><div class="loading-orbit"><i></i></div><div>Loading Atlas receipts…</div></div>';
  try {
    await renderers[target]();
    history.replaceState(null, '', `#${target}`);
  } catch (error) {
    if (error.status === 401 && operatorToken) {
      operatorToken = '';
      operatorButton.textContent = 'Unlock controls';
    }
    setConnection(false);
    view.innerHTML = `<div class="error-panel"><strong>Atlas surface failed.</strong><br>${esc(error.message)}</div>`;
  }
}

function bindNavigationActions() {
  document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.goView)));
}

async function runAdapter(adapterName, streamId, button) {
  if (!requireOperator()) return;
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const result = await requestJson(`/operator-api/streams/${encodeURIComponent(adapterName)}/run`, { operator: true, method: 'POST', body: {} });
    showToast(`${streamId}: ${result.outcome} · event delta ${number(result.event_delta)} · receipt ${compactHash(result.action_receipt_hash)}`, result.status === 'error' ? 'error' : 'ok');
    await navigate(currentView);
  } catch (error) {
    showToast(`${streamId}: ${error.message}`, 'error');
    button.disabled = false;
    button.textContent = 'Run now';
  }
}

async function changeStreamStatus(streamId, status, button) {
  if (!requireOperator()) return;
  button.disabled = true;
  try {
    const result = await requestJson(`/operator-api/streams/${encodeURIComponent(streamId)}/status`, { operator: true, method: 'PATCH', body: { status } });
    showToast(`${streamId}: ${result.stream.status} · receipt ${compactHash(result.action_receipt_hash)}`);
    await navigate(currentView);
  } catch (error) {
    showToast(`${streamId}: ${error.message}`, 'error');
    button.disabled = false;
  }
}

async function reconcileHealth(button) {
  if (!requireOperator()) return;
  button.disabled = true;
  button.textContent = 'Reconciling…';
  try {
    const result = await requestJson('/operator-api/source-health/reconcile', { operator: true, method: 'POST', body: { limit: 1000 } });
    showToast(`Health receipts: ${number(result.persisted_count)} new · ${number(result.idempotent_count)} idempotent · ${compactHash(result.action_receipt_hash)}`);
    await navigate(currentView);
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Reconcile source health';
  }
}

async function runSignalDetector(button) {
  if (!requireOperator()) return;
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const result = await requestJson('/operator-api/live-data-signals/run', { operator: true, method: 'POST', body: {} });
    showToast(`Signal detector: ${result.status} · bridged ${number(result.bridged)} · receipt ${compactHash(result.action_receipt_hash)}`);
    await navigate(currentView);
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Run signal detector';
  }
}

async function loadDeterministicOutputs(button) {
  if (!requireOperator()) return;
  button.disabled = true;
  button.textContent = 'Loading…';
  try {
    const data = await requestJson('/operator-api/substrate', { operator: true });
    const output = document.getElementById('deterministicOutput');
    output.hidden = false;
    output.innerHTML = `<div class="panel-header"><div><div class="eyebrow">DETERMINISTIC OUTPUTS</div><h2>Persisted patterns and investigations</h2></div><small>${dateTime(data.observed_at)}</small></div><div class="panel-body"><div class="output-grid"><div><h3>Prime patterns</h3>${data.prime_patterns.length ? data.prime_patterns.map((row) => `<article class="output-card"><div>${badge(row.severity)} ${badge(row.pattern_type)}</div><h4>${esc(row.summary)}</h4><small>${esc(row.stream_id ?? 'cross-stream')} · confidence ${esc(row.confidence)} · ${dateTime(row.detected_at)}</small><div class="mono">${esc(row.pattern_id)}</div></article>`).join('') : '<p>No prime patterns persisted.</p>'}</div><div><h3>Investigation jobs</h3>${data.investigative_jobs.length ? data.investigative_jobs.map((row) => `<article class="output-card"><div>${badge(row.status)}</div><h4>${esc(row.function_id ?? row.job_type)}</h4><small>${esc(row.stream_id ?? 'cross-stream')} · ${dateTime(row.completed_at ?? row.created_at)}</small><div class="mono">${esc(row.job_id)}</div>${row.error ? `<p class="form-error">${esc(row.error)}</p>` : ''}</article>`).join('') : '<p>No investigation jobs persisted.</p>'}</div></div></div>`;
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
    button.disabled = false;
    button.textContent = 'Reload deterministic outputs';
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
    button.textContent = 'Load deterministic outputs';
  }
}

async function registerStream(event) {
  event.preventDefault();
  if (!requireOperator()) return;
  const option = document.getElementById('registerAdapter').selectedOptions[0];
  const body = {
    adapter_name: option.value,
    stream_id: option.dataset.streamId,
    source_id: document.getElementById('registerSource').value,
    jurisdiction_id: document.getElementById('registerJurisdiction').value,
    module_hint: document.getElementById('registerModule').value,
    throughput_profile: document.getElementById('registerThroughput').value,
    safety_profile: document.getElementById('registerSafety').value,
    governance_contract_id: document.getElementById('registerGovernance').value,
  };
  try {
    const result = await requestJson('/operator-api/streams', { operator: true, method: 'POST', body });
    showToast(`${result.stream.stream_id} registered · receipt ${compactHash(result.action_receipt_hash)}`);
    await navigate('operations');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function bindOperatorActions() {
  document.querySelectorAll('[data-unlock]').forEach((button) => button.addEventListener('click', openOperatorDialog));
  document.querySelectorAll('[data-lock]').forEach((button) => button.addEventListener('click', () => {
    operatorToken = '';
    operatorButton.textContent = 'Unlock controls';
    showToast('Operator controls locked.');
    navigate(currentView);
  }));
  document.querySelectorAll('[data-run-adapter]').forEach((button) => button.addEventListener('click', () => runAdapter(button.dataset.runAdapter, button.dataset.streamId, button)));
  document.querySelectorAll('[data-stream-status]').forEach((button) => button.addEventListener('click', () => changeStreamStatus(button.dataset.streamId, button.dataset.streamStatus, button)));
  document.querySelectorAll('[data-reconcile-health]').forEach((button) => button.addEventListener('click', () => reconcileHealth(button)));
  document.querySelectorAll('[data-run-signals]').forEach((button) => button.addEventListener('click', () => runSignalDetector(button)));
  document.querySelectorAll('[data-load-outputs]').forEach((button) => button.addEventListener('click', () => loadDeterministicOutputs(button)));
  document.querySelectorAll('[data-refresh-current]').forEach((button) => button.addEventListener('click', () => navigate(currentView)));
}

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
refreshButton.addEventListener('click', () => navigate(currentView));
operatorButton.addEventListener('click', () => {
  if (operatorToken) {
    operatorToken = '';
    operatorButton.textContent = 'Unlock controls';
    showToast('Operator controls locked.');
    navigate(currentView);
  } else {
    openOperatorDialog();
  }
});
document.getElementById('operatorCancel').addEventListener('click', () => operatorDialog.close());
operatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = operatorTokenInput.value;
  operatorError.hidden = true;
  try {
    await requestJson('/operator-api/status', { token: candidate });
    operatorToken = candidate;
    operatorTokenInput.value = '';
    operatorButton.textContent = 'Lock controls';
    operatorDialog.close();
    showToast('Atlas operator controls unlocked for this page session.');
    await navigate(currentView);
  } catch (error) {
    operatorError.textContent = error.status === 401 ? 'Control token was not accepted.' : error.message;
    operatorError.hidden = false;
  }
});

setInterval(() => {
  if (!operatorDialog.open && document.visibilityState === 'visible') navigate(currentView);
}, 60_000);

navigate(location.hash.slice(1) || 'overview');

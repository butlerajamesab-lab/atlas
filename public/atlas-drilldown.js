const publicCache = new Map();
let operatorToken = '';

const form = document.getElementById('operatorForm');
const tokenInput = document.getElementById('operatorToken');
if (form && tokenInput) {
  form.addEventListener('submit', () => {
    operatorToken = tokenInput.value.trim();
  }, { capture: true });
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function activeView() {
  return document.querySelector('.nav-item.active')?.dataset?.view || 'overview';
}

function panelTitle(element) {
  return element.closest('.panel')?.querySelector('.panel-header h2')?.textContent?.trim() || '';
}

function compactMatch(displayed, actual) {
  const shown = String(displayed ?? '').trim();
  const value = String(actual ?? '');
  if (!shown || !value) return false;
  if (!shown.includes('…')) return shown === value;
  const [prefix, suffix] = shown.split('…');
  return value.startsWith(prefix) && value.endsWith(suffix);
}

async function requestJson(url, operator = false) {
  const cacheKey = `${operator ? 'operator' : 'public'}:${url}`;
  if (!operator && publicCache.has(cacheKey)) return publicCache.get(cacheKey);
  const headers = { accept: 'application/json' };
  if (operator) {
    if (!operatorToken) throw new Error('Unlock operator controls to expose protected receipts and candidate evidence.');
    headers.authorization = `Bearer ${operatorToken}`;
  }
  const response = await fetch(url, { headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.details || payload.error || `${response.status} ${response.statusText}`);
  if (!operator) publicCache.set(cacheKey, payload);
  return payload;
}

function ensureDialog() {
  let dialog = document.getElementById('atlasInspectDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'atlasInspectDialog';
  dialog.className = 'atlas-inspect-dialog';
  dialog.innerHTML = `
    <div class="atlas-inspect-shell">
      <header><div><div class="eyebrow">INSPECTION RECEIPT</div><h2 id="atlasInspectTitle">Details</h2><p id="atlasInspectSubtitle"></p></div><button type="button" id="atlasInspectClose">Close</button></header>
      <div id="atlasInspectBody" class="atlas-inspect-body"></div>
    </div>`;
  document.body.appendChild(dialog);
  document.getElementById('atlasInspectClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  const style = document.createElement('style');
  style.textContent = `
    .atlas-inspect-dialog{width:min(920px,94vw);max-height:90vh;border:1px solid #21414d;background:#071219;color:#d7e4e8;padding:0;border-radius:4px;box-shadow:0 24px 80px #000b}
    .atlas-inspect-dialog::backdrop{background:#000a;backdrop-filter:blur(2px)}
    .atlas-inspect-shell header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:20px 22px;border-bottom:1px solid #17333d;background:#071219}
    .atlas-inspect-shell header h2{margin:4px 0 4px;font-family:Georgia,serif;font-weight:400;font-size:26px}.atlas-inspect-shell header p{margin:0;color:#7f9ba4;font-size:12px}
    .atlas-inspect-shell header button{border:1px solid #28505c;background:transparent;color:#9fc4ce;padding:8px 12px;font:inherit;cursor:pointer}
    .atlas-inspect-body{padding:18px 22px 26px;overflow:auto}.atlas-inspect-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:16px}
    .atlas-inspect-field{border:1px solid #17333d;background:#08171e;padding:10px}.atlas-inspect-field span{display:block;color:#6e9099;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.atlas-inspect-field strong{font-size:12px;word-break:break-word}
    .atlas-inspect-json{white-space:pre-wrap;word-break:break-word;background:#050d11;border:1px solid #17333d;padding:12px;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#abc4ca;max-height:55vh;overflow:auto}
    .atlas-inspect-note{border-left:2px solid #2a8995;padding:10px 12px;background:#0a1a20;color:#9eb8bf;font-size:12px;margin-bottom:14px}
    .source-table tbody tr,.version-card,.readiness-row{cursor:pointer}.source-table tbody tr:hover{background:#0b1b22}
  `;
  document.head.appendChild(style);
  return dialog;
}

function summarizeObject(object) {
  if (!object || typeof object !== 'object') return '';
  const priority = [
    'stream_id','source_id','jurisdiction_id','module_hint','status','adapter_name','observation_count','identity_bound_observation_count',
    'signal_type','signal_type_name','rule_id','rule_version','engine_id','engine_version','verification_state','entity_resolution_status',
    'candidate_hash','signal_hash','input_hash','action_receipt_hash','run_id','run_key','outcome_status','event_delta','detected_at','completed_at',
  ];
  const entries = priority
    .filter((key) => Object.prototype.hasOwnProperty.call(object, key))
    .map((key) => [key, object[key]])
    .filter(([, value]) => value !== null && value !== undefined && value !== '');
  return `<div class="atlas-inspect-grid">${entries.map(([key,value]) => `<div class="atlas-inspect-field"><span>${esc(key.replaceAll('_',' '))}</span><strong>${esc(typeof value === 'object' ? JSON.stringify(value) : value)}</strong></div>`).join('')}</div>`;
}

function openDetail(title, subtitle, object, extra = null) {
  const dialog = ensureDialog();
  document.getElementById('atlasInspectTitle').textContent = title;
  document.getElementById('atlasInspectSubtitle').textContent = subtitle || '';
  const body = document.getElementById('atlasInspectBody');
  body.innerHTML = `${extra ? `<div class="atlas-inspect-note">${esc(extra)}</div>` : ''}${summarizeObject(object)}<pre class="atlas-inspect-json">${esc(pretty(object))}</pre>`;
  if (!dialog.open) dialog.showModal();
}

function rowCells(row) {
  return [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim());
}

async function inspectSource(row) {
  const data = await requestJson('/ui-api/overview');
  const name = row.querySelector('strong')?.textContent?.trim();
  const source = data.sources?.find((item) => item.source_name === name);
  if (source) openDetail(name, 'Canonical source binding and independently observed readiness state.', source);
}

async function inspectStream(row) {
  const data = await requestJson('/ui-api/streams');
  const streamId = row.querySelector('strong')?.textContent?.trim();
  const stream = data.streams?.find((item) => item.stream_id === streamId);
  if (!stream) return;
  let enriched = stream;
  let note = 'Public stream contract and normalized-observation production state.';
  if (operatorToken) {
    try {
      const substrate = await requestJson('/operator-api/substrate', true);
      const receipts = (substrate.action_receipts || []).filter((receipt) => receipt.target_id === streamId).slice(0, 20);
      enriched = { ...stream, recent_action_receipts: receipts };
      note = 'Stream contract plus protected action receipts. Credentials are never included.';
    } catch { /* public detail remains useful */ }
  }
  openDetail(streamId, note, enriched);
}

async function inspectSubstrate(row) {
  const data = await requestJson('/ui-api/signal-derivation');
  const cells = rowCells(row);
  const panel = panelTitle(row);
  let object = null;
  let title = cells[0] || panel;
  let note = '';

  if (panel === 'Canonical normalized signals') {
    const key = row.querySelector('strong')?.textContent?.trim();
    object = data.canonical_signal_types?.find((item) => item.signal_type_name === key || item.signal_type_code === key);
    note = 'Canonical signal-type aggregate. A signal is distinct from its source observations.';
  } else if (panel === 'Declared signal rules') {
    const ruleId = row.querySelector('strong')?.textContent?.trim();
    object = data.candidate_rules?.find((item) => item.rule_id === ruleId);
    if (operatorToken) {
      const substrate = await requestJson('/operator-api/substrate', true);
      object = {
        ...object,
        candidates: (substrate.signal_candidates || []).filter((candidate) => candidate.rule_id === ruleId),
        derivation_receipts: (substrate.action_receipts || []).filter((receipt) => receipt.action_type === 'signal_candidate_derivation_run'),
      };
      note = 'Governed rule plus candidate evidence, entity-resolution state, source-event references, and derivation receipts.';
    } else {
      note = 'Governed rule aggregate. Unlock operator controls to include candidate evidence and receipts.';
    }
  } else if (panel === 'Source rows transformed into bounded signals') {
    const shown = cells[0];
    object = data.convergence_runs?.find((item) => compactMatch(shown, item.run_key));
    note = 'Immutable convergence run accounting; source rows, transformed signals, deduplication, and detected convergence remain separate counts.';
  } else if (panel === 'Adapter classifications—not derived signal counts') {
    const [classification, stream, module, jurisdiction] = cells;
    object = data.observation_classifications?.find((item) =>
      item.observation_classification === classification && item.stream_id === stream && item.module_hint === module && item.jurisdiction_id === jurisdiction);
    note = 'Observation distribution only. This classification is not itself a civic signal.';
  } else if (operatorToken) {
    const substrate = await requestJson('/operator-api/substrate', true);
    const text = row.textContent || '';
    object = (substrate.signal_candidates || []).find((candidate) => text.includes(candidate.title || ''))
      || (substrate.legacy_prime_patterns || []).find((pattern) => text.includes(pattern.summary || ''))
      || (substrate.legacy_investigative_jobs || []).find((job) => text.includes(job.job_id || ''));
    note = 'Protected deterministic output detail.';
  }

  if (object) openDetail(title, panel, object, note);
}

async function inspectLegislative(card) {
  const data = await requestJson('/ui-api/legislative-history?limit=100');
  const text = card.textContent || '';
  const observation = data.observations?.find((item) => {
    const version = item.payload?.version || {};
    return version.source_document_key && text.includes(String(version.source_document_key));
  });
  if (!observation) return;
  const version = observation.payload?.version || {};
  openDetail(
    String(version.version_type || 'Legislative version').replaceAll('_',' '),
    'Source-bound legislative generation with preserved Rosetta/Prism state and failure detail.',
    observation,
    version.failure_code ? 'Failure is retained as first-class legislative history rather than collapsed or silently retried.' : null,
  );
}

async function inspectOperation(row) {
  if (!operatorToken) {
    openDetail('Operator detail locked', 'Operations', { requirement: 'Unlock Atlas controls to inspect runtime receipts and exact failure results.' });
    return;
  }
  const status = await requestJson('/operator-api/status', true);
  const adapterName = row.querySelector('strong')?.textContent?.trim() || rowCells(row)[0];
  const adapter = status.scheduler?.adapters?.find((item) => item.name === adapterName || item.stream_id === adapterName);
  const receipts = (status.recent_receipts || []).filter((receipt) => receipt.target_id === adapter?.stream_id || receipt.target_id === adapterName);
  if (adapter) openDetail(adapter.name, 'Compiled runtime adapter, last result, and governed action receipts.', { ...adapter, recent_receipts: receipts });
}

async function handleClick(event) {
  if (event.defaultPrevented) return;
  if (event.target.closest('a,button,input,select,textarea,summary,[role="button"]')) return;
  const view = activeView();
  const row = event.target.closest('tr');
  const card = event.target.closest('.version-card');
  try {
    if (view === 'sources' && row) return await inspectSource(row);
    if (view === 'streams' && row) return await inspectStream(row);
    if (view === 'substrate' && row) return await inspectSubstrate(row);
    if (view === 'legislative' && card) return await inspectLegislative(card);
    if (view === 'operations' && row) return await inspectOperation(row);
  } catch (error) {
    openDetail('Inspection unavailable', view, { error: error instanceof Error ? error.message : String(error) });
  }
}

document.addEventListener('click', (event) => { void handleClick(event); });

document.addEventListener('click', (event) => {
  if (event.target.closest('#refreshButton,.nav-item')) publicCache.clear();
});

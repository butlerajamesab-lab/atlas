// Atlas reservoir viewer — operator surface over signal_events.
// The control token lives in page memory only (same posture as the
// Atlas console's operator unlock). Read-only: this page never
// writes, promotes, or attaches; those doors stay governed.

let rvToken = '';
let rvCurrentStream = null;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function rvFetch(path) {
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${rvToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showMainError(message) {
  const el = $('rvMainError');
  if (el) el.textContent = message ?? '';
}

function setState(text, live) {
  $('rvState').textContent = text;
  $('rvDot').className = `status-dot${live ? ' live' : ''}`;
}

async function loadCensus() {
  const census = await rvFetch('/reservoir-api/streams');
  setState('UNLOCKED', true);
  const rows = census.streams
    .map(
      (s) => `<tr data-stream="${esc(s.stream_id)}">
        <td>${esc(s.stream_id)}</td>
        <td>${esc(s.status)}</td>
        <td>${esc(s.source_id)}</td>
        <td>${esc(s.jurisdiction_id)}</td>
        <td class="rv-num">${s.record_count.toLocaleString('en-US')}</td>
        <td class="rv-num">${s.latest_offset ?? '—'}</td>
        <td>${esc(s.latest_ingested_at ?? '—')}</td>
      </tr>`,
    )
    .join('');
  $('rvCensus').innerHTML = `
    <div class="rv-total">TOTAL RECORDS IN POOL: ${census.total_records.toLocaleString('en-US')} across ${census.stream_count} streams</div>
    <table class="rv-table">
      <thead><tr><th>Stream</th><th>Status</th><th>Source</th><th>Jurisdiction</th><th class="rv-num">Records</th><th class="rv-num">Latest offset</th><th>Latest ingested</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  for (const row of $('rvCensus').querySelectorAll('tr[data-stream]')) {
    row.addEventListener('click', () => loadRecords(row.dataset.stream));
  }
}

async function loadRecords(streamId, beforeOffset = null) {
  showMainError('');
  rvCurrentStream = streamId;
  const params = new URLSearchParams({ limit: '50' });
  if (beforeOffset !== null) params.set('before_offset', String(beforeOffset));
  let page;
  try {
    page = await rvFetch(
      `/reservoir-api/streams/${encodeURIComponent(streamId)}/records?${params}`,
    );
  } catch (error) {
    showMainError(`Could not load records for ${streamId}: ${error.message}`);
    return;
  }
  const rows = page.records
    .map(
      (r) => `<tr data-offset="${r.offset}">
        <td class="rv-num">${r.offset}</td>
        <td>${esc(r.timestamp)}</td>
        <td>${esc(r.signal_type)}</td>
        <td>${esc(r.source_id)}</td>
        <td>${esc(r.event_identity_hash ?? '—')}</td>
        <td>${esc(r.ingested_at)}</td>
      </tr>`,
    )
    .join('');
  $('rvRecords').innerHTML = `
    <div class="rv-crumb-line"><button id="rvBack" type="button">← All streams</button> · ${esc(streamId)} — ${page.total_records.toLocaleString('en-US')} records, newest first</div>
    <table class="rv-table">
      <thead><tr><th class="rv-num">Offset</th><th>Event time</th><th>Signal type</th><th>Source</th><th>Identity hash</th><th>Ingested</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">No records.</td></tr>'}</tbody>
    </table>
    ${page.has_more ? '<div class="rv-pager"><button id="rvOlder" class="top-button" type="button">Older records →</button></div>' : ''}`;
  $('rvDetail').innerHTML = '';
  $('rvBack').addEventListener('click', () => {
    $('rvRecords').innerHTML = '';
    $('rvDetail').innerHTML = '';
    rvCurrentStream = null;
  });
  const older = $('rvOlder');
  if (older) {
    older.addEventListener('click', () => loadRecords(streamId, page.next_before_offset));
  }
  for (const row of $('rvRecords').querySelectorAll('tr[data-offset]')) {
    row.addEventListener('click', () => loadRecord(streamId, row.dataset.offset));
  }
}

async function loadRecord(streamId, offset) {
  showMainError('');
  $('rvDetail').innerHTML =
    '<div class="rv-pane">Loading record…</div>';
  let record;
  try {
    record = await rvFetch(
      `/reservoir-api/streams/${encodeURIComponent(streamId)}/records/${encodeURIComponent(offset)}`,
    );
  } catch (error) {
    // No silent failure: the error is shown where the click happened.
    $('rvDetail').innerHTML = `<div class="rv-pane"><span class="rv-error">Could not open record ${esc(offset)}: ${esc(error.message)}</span></div>`;
    $('rvDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  $('rvDetail').innerHTML = `
    <div class="rv-pane">
      <div style="font:700 13px var(--mono);color:var(--bright);">${esc(record.stream_id)} · offset ${record.offset}</div>
      <p style="color:var(--muted);">Reference this record carries: <span class="rv-ref">${esc(record.reference.stream_id)} / ${record.reference.offset} / ${esc(record.reference.event_identity_hash ?? 'no hash')}</span></p>
      <div style="color:var(--bright);font:11px var(--mono);margin-top:12px;">PROVENANCE</div>
      <pre>${esc(JSON.stringify(record.provenance, null, 2))}</pre>
      <div style="color:var(--bright);font:11px var(--mono);margin-top:12px;">SPACETIME</div>
      <pre>${esc(JSON.stringify(record.spacetime, null, 2))}</pre>
      <div style="color:var(--bright);font:11px var(--mono);margin-top:12px;">PAYLOAD — THE SOURCE RECORD AS STORED</div>
      <pre>${esc(JSON.stringify(record.payload, null, 2))}</pre>
    </div>`;
  $('rvDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('rvUnlock').addEventListener('click', async () => {
  const candidate = $('rvToken').value.trim();
  if (!candidate) return;
  rvToken = candidate;
  $('rvError').textContent = '';
  try {
    await loadCensus();
    $('rvLock').hidden = true;
    $('rvMain').hidden = false;
  } catch (error) {
    rvToken = '';
    setState('LOCKED', false);
    $('rvError').textContent =
      error.status === 401 ? 'Control token was not accepted.' : error.message;
  }
});

$('rvRefresh').addEventListener('click', async () => {
  if (!rvToken) return;
  try {
    if (rvCurrentStream) await loadRecords(rvCurrentStream);
    else await loadCensus();
  } catch (error) {
    $('rvError').textContent = error.message;
  }
});

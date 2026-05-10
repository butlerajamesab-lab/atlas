'use strict';

/**
 * Form Signal Extraction Engine V3 — Lighthouse Backfill Runner
 *
 * Reads from Lighthouse tables (read-only):
 *   - legal_statutes
 *   - agencies_registry
 *   - forms_registry
 *   - filing_templates
 *   - workflow_steps
 *   - remedy_templates
 *
 * Writes staged output into Atlas-owned staging tables:
 *   - forms_registry_staging
 *   - extraction_provenance
 *   - validation_review_queue
 *
 * Rules:
 *   - Lighthouse is READ-ONLY. No writes to Lighthouse.
 *   - All output goes to Atlas staging tables.
 *   - Nothing is auto-promoted. review_required = true, source_verified = false.
 *   - Does NOT overwrite existing forms_registry rows.
 */

const { FormSignalExtractionEngine } = require('./index.js');

const LIGHTHOUSE_URL = process.env.LIGHTHOUSE_URL || 'https://wepxlinwbjrkqdzkqpar.supabase.co';
const LIGHTHOUSE_KEY = process.env.LIGHTHOUSE_ANON_KEY || process.env.SUPABASE_KEY || '';

const ATLAS_URL = process.env.ATLAS_URL || 'https://bjdjjgnkhxblnpdrjqtw.supabase.co';
const ATLAS_KEY = process.env.ATLAS_SERVICE_KEY || process.env.SUPABASE_KEY || '';

async function supabaseGet(baseUrl, apiKey, table, params = '') {
  const url = `${baseUrl}/rest/v1/${table}?${params}`;
  const resp = await fetch(url, {
    headers: {
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GET ${table} failed (${resp.status}): ${body}`);
  }
  return resp.json();
}

async function supabasePost(baseUrl, apiKey, table, rows) {
  if (!rows || rows.length === 0) return { count: 0 };
  const url = `${baseUrl}/rest/v1/${table}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': apiKey,
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`POST ${table} failed (${resp.status}): ${body}`);
  }
  return { count: rows.length };
}

async function readLighthouseData() {
  console.log('[backfill] Reading from Lighthouse (read-only)...');

  const [
    statutes,
    agencies,
    forms,
    filingTemplates,
    workflowSteps,
    remedyTemplates,
  ] = await Promise.all([
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'legal_statutes', 'select=*&limit=1000'),
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'agencies_registry', 'select=*&limit=1000'),
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'forms_registry', 'select=*&limit=1000'),
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'filing_templates', 'select=*&limit=1000'),
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'workflow_steps', 'select=*&limit=1000'),
    supabaseGet(LIGHTHOUSE_URL, LIGHTHOUSE_KEY, 'remedy_templates', 'select=*&limit=1000'),
  ]);

  console.log(`[backfill] Lighthouse data loaded:`);
  console.log(`  legal_statutes: ${statutes.length}`);
  console.log(`  agencies_registry: ${agencies.length}`);
  console.log(`  forms_registry: ${forms.length}`);
  console.log(`  filing_templates: ${filingTemplates.length}`);
  console.log(`  workflow_steps: ${workflowSteps.length}`);
  console.log(`  remedy_templates: ${remedyTemplates.length}`);

  return { statutes, agencies, forms, filingTemplates, workflowSteps, remedyTemplates };
}

function buildTextPayloads(data) {
  const payloads = [];

  // Build text blocks from statutes
  for (const s of data.statutes) {
    const parts = [s.title, s.statute_code, s.description, s.full_text, s.jurisdiction].filter(Boolean);
    if (parts.length > 0) {
      payloads.push({
        text: parts.join('\n\n'),
        descriptor: { source_type: 'legal_statutes', source_id: s.id, source_name: s.title || s.statute_code },
      });
    }
  }

  // Build text blocks from filing templates
  for (const ft of data.filingTemplates) {
    const parts = [ft.name, ft.title, ft.description, ft.instructions, ft.template_body, ft.jurisdiction].filter(Boolean);
    if (parts.length > 0) {
      payloads.push({
        text: parts.join('\n\n'),
        descriptor: { source_type: 'filing_templates', source_id: ft.id, source_name: ft.name || ft.title },
      });
    }
  }

  // Build text blocks from workflow steps
  for (const ws of data.workflowSteps) {
    const parts = [ws.name, ws.title, ws.description, ws.instructions, ws.action_text].filter(Boolean);
    if (parts.length > 0) {
      payloads.push({
        text: parts.join('\n\n'),
        descriptor: { source_type: 'workflow_steps', source_id: ws.id, source_name: ws.name || ws.title },
      });
    }
  }

  // Build text blocks from remedy templates
  for (const rt of data.remedyTemplates) {
    const parts = [rt.name, rt.title, rt.description, rt.template_body, rt.remedy_type, rt.jurisdiction].filter(Boolean);
    if (parts.length > 0) {
      payloads.push({
        text: parts.join('\n\n'),
        descriptor: { source_type: 'remedy_templates', source_id: rt.id, source_name: rt.name || rt.title },
      });
    }
  }

  console.log(`[backfill] Built ${payloads.length} text payloads for extraction`);
  return payloads;
}

async function writeToAtlasStaging(allResults) {
  console.log('[backfill] Writing staged output to Atlas...');

  const formsStaging = [];
  const provenanceRows = [];
  const reviewQueue = [];

  for (const result of allResults) {
    if (!result.staging_output) continue;

    for (const form of result.staging_output.forms_registry_staging || []) {
      formsStaging.push({
        ...form,
        review_required: true,
        source_verified: false,
        promoted: false,
      });
    }

    for (const prov of result.staging_output.extraction_provenance || []) {
      provenanceRows.push(prov);
    }

    for (const review of result.staging_output.validation_review_queue || []) {
      reviewQueue.push(review);
    }
  }

  console.log(`[backfill] Staging totals:`);
  console.log(`  forms_registry_staging: ${formsStaging.length}`);
  console.log(`  extraction_provenance: ${provenanceRows.length}`);
  console.log(`  validation_review_queue: ${reviewQueue.length}`);

  // Write to Atlas staging tables
  if (formsStaging.length > 0) {
    try {
      await supabasePost(ATLAS_URL, ATLAS_KEY, 'forms_registry_staging', formsStaging);
      console.log(`[backfill] ✓ forms_registry_staging: ${formsStaging.length} rows written`);
    } catch (e) {
      console.log(`[backfill] ✗ forms_registry_staging: ${e.message}`);
      console.log(`[backfill]   (Table may not exist yet — staged data saved to local JSON)`);
    }
  }

  if (provenanceRows.length > 0) {
    try {
      await supabasePost(ATLAS_URL, ATLAS_KEY, 'extraction_provenance', provenanceRows);
      console.log(`[backfill] ✓ extraction_provenance: ${provenanceRows.length} rows written`);
    } catch (e) {
      console.log(`[backfill] ✗ extraction_provenance: ${e.message}`);
    }
  }

  if (reviewQueue.length > 0) {
    try {
      await supabasePost(ATLAS_URL, ATLAS_KEY, 'validation_review_queue', reviewQueue);
      console.log(`[backfill] ✓ validation_review_queue: ${reviewQueue.length} rows written`);
    } catch (e) {
      console.log(`[backfill] ✗ validation_review_queue: ${e.message}`);
    }
  }

  // Always save local JSON backup
  const fs = require('fs');
  const outputPath = require('path').join(__dirname, 'backfill_output.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    forms_registry_staging: formsStaging,
    extraction_provenance: provenanceRows,
    validation_review_queue: reviewQueue,
  }, null, 2));
  console.log(`[backfill] Local backup saved to ${outputPath}`);

  return { formsStaging: formsStaging.length, provenance: provenanceRows.length, review: reviewQueue.length };
}

async function main() {
  console.log('=== Form Signal Extraction Engine V3 — Lighthouse Backfill ===');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // 1. Read from Lighthouse (read-only)
  const data = await readLighthouseData();

  // 2. Build text payloads
  const payloads = buildTextPayloads(data);

  if (payloads.length === 0) {
    console.log('[backfill] No text payloads to process. Exiting.');
    return;
  }

  // 3. Run extraction engine
  const engine = new FormSignalExtractionEngine();
  const allResults = [];
  let totalForms = 0;
  let totalHighConf = 0;

  for (const payload of payloads) {
    try {
      const result = engine.extract(payload.text, payload.descriptor);
      allResults.push(result);
      totalForms += result.stats.total;
      totalHighConf += result.stats.high_confidence_total;
    } catch (e) {
      console.log(`[backfill] Extraction error for ${payload.descriptor.source_name}: ${e.message}`);
    }
  }

  console.log(`[backfill] Extraction complete: ${totalForms} forms found, ${totalHighConf} high-confidence`);

  // 4. Write to Atlas staging (NOT Lighthouse)
  const counts = await writeToAtlasStaging(allResults);

  console.log('');
  console.log('=== Backfill Summary ===');
  console.log(`Sources processed: ${payloads.length}`);
  console.log(`Total proto-forms: ${totalForms}`);
  console.log(`High-confidence: ${totalHighConf}`);
  console.log(`Staged for review: ${counts.formsStaging}`);
  console.log(`Provenance records: ${counts.provenance}`);
  console.log(`Review queue items: ${counts.review}`);
  console.log('');
  console.log('All output is review_required=true, source_verified=false.');
  console.log('Nothing auto-promoted. Lighthouse displays after bridge/review.');
}

main().catch(err => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});

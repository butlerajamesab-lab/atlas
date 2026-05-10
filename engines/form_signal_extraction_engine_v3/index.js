'use strict';

const crypto = require('crypto');

// ============================================================================ // FORM SIGNAL EXTRACTION ENGINE V3 // Deterministic civic/procedural form-signal extraction module. // // Scope: // - Extract possible form/action/procedural signals from already-available text. // - Preserve ambiguity through candidate arrays instead of collapsing early. // - Produce staging-ready records for downstream registry/enrichment workflows. // - Attach provenance, parser metadata, source hashes, validation flags, and review status. // // Non-scope: // - This does not OCR PDFs. // - This does not verify live URLs. // - This does not make legal determinations. // - This does not decide final workflow routing without downstream verification. // ============================================================================

const ENGINE_METADATA = Object.freeze({ engine_id: 'form_signal_extraction_engine', engine_version: '3.0.0', schema_version: 'forms_registry_staging.v1', deterministic: true, output_contract: 'proto_form_signal_bundle.v1', });

const DEFAULT_CONFIDENCE_THRESHOLD = 3; const DEFAULT_CONTEXT_WINDOW = 500;

// ============================================================================ // UTILS // ============================================================================

function sha256(value) { return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex'); }

function stableId(prefix, parts) { const cleanPrefix = String(prefix || 'id').replace(/[^a-zA-Z0-9_-]/g, '_'); return ${cleanPrefix}_${sha256(JSON.stringify(parts)).slice(0, 24)}; }

function cloneRegex(regex) { return new RegExp(regex.source, regex.flags.replace('g', '') + (regex.flags.includes('g') ? 'g' : '')); }

function testRegex(regex, text) { return new RegExp(regex.source, regex.flags.replace('g', '')).test(text); }

function normalizeWhitespace(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }

function normalizeUrl(rawUrl) { if (!rawUrl) return null;

let url = String(rawUrl).trim(); url = url.replace(/[).,;:]+$/g, '');

if (/^www./i.test(url)) { url = https://${url}; }

if (!/^https?:///i.test(url) && /^[a-zA-Z0-9.-]+.(gov|org|com|edu|net|us)\b/i.test(url)) { url = https://${url}; }

try { const parsed = new URL(url); parsed.hash = ''; parsed.hostname = parsed.hostname.toLowerCase(); parsed.pathname = parsed.pathname.replace(//$/, ''); return parsed.toString(); } catch (_) { return rawUrl.trim(); } }

function normalizeName(name) { return normalizeWhitespace(name).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^|_$/g, ''); }

function uniqueBy(items, keyFn) { const map = new Map(); for (const item of items || []) { const key = keyFn(item); if (!map.has(key)) map.set(key, item); } return Array.from(map.values()); }

function firstOrNull(items) { return Array.isArray(items) && items.length > 0 ? items[0] : null; }

// ============================================================================ // REGISTRIES // ============================================================================

const AGENCY_REGISTRY = Object.freeze({ EEOC: { canonical_entity_id: 'agency_federal_eeoc', agency_name: 'EEOC', display_name: 'Equal Employment Opportunity Commission', patterns: [/\bEEOC\b/i, /Equal Employment Opportunity Commission/i], aliases: ['EEOC', 'Equal Employment Opportunity Commission'], jurisdiction: ['Federal', 'CA', 'NY', 'TX', 'FL', 'WA'], domains: ['wage', 'legal'], source_verification: 'registry_seed_unverified', }, CFPB: { canonical_entity_id: 'agency_federal_cfpb', agency_name: 'CFPB', display_name: 'Consumer Financial Protection Bureau', patterns: [/\bCFPB\b/i, /Consumer Financial Protection Bureau/i, /Bureau of Consumer Financial Protection/i], aliases: ['CFPB', 'Consumer Financial Protection Bureau'], jurisdiction: ['Federal'], domains: ['insurance', 'legal'], source_verification: 'registry_seed_unverified', }, FTC: { canonical_entity_id: 'agency_federal_ftc', agency_name: 'FTC', display_name: 'Federal Trade Commission', patterns: [/\bFTC\b/i, /Federal Trade Commission/i], aliases: ['FTC', 'Federal Trade Commission'], jurisdiction: ['Federal'], domains: ['legal'], source_verification: 'registry_seed_unverified', }, DOL: { canonical_entity_id: 'agency_federal_dol', agency_name: 'DOL', display_name: 'Department of Labor', patterns: [/\bDOL\b/i, /Department of Labor/i, /U.S. Department of Labor/i, /US Department of Labor/i], aliases: ['DOL', 'Department of Labor', 'U.S. Department of Labor'], jurisdiction: ['Federal'], domains: ['wage'], source_verification: 'registry_seed_unverified', }, HUD: { canonical_entity_id: 'agency_federal_hud', agency_name: 'HUD', display_name: 'Department of Housing and Urban Development', patterns: [/\bHUD\b/i, /Department of Housing and Urban Development/i, /Housing and Urban Development/i], aliases: ['HUD', 'Housing and Urban Development'], jurisdiction: ['Federal'], domains: ['housing'], source_verification: 'registry_seed_unverified', }, SSA: { canonical_entity_id: 'agency_federal_ssa', agency_name: 'SSA', display_name: 'Social Security Administration', patterns: [/\bSSA\b/i, /Social Security Administration/i, /\bSocial Security\b/i], aliases: ['SSA', 'Social Security Administration'], jurisdiction: ['Federal'], domains: ['benefits'], source_verification: 'registry_seed_unverified', }, OSHA: { canonical_entity_id: 'agency_federal_osha', agency_name: 'OSHA', display_name: 'Occupational Safety and Health Administration', patterns: [/\bOSHA\b/i, /Occupational Safety and Health Administration/i], aliases: ['OSHA'], jurisdiction: ['Federal'], domains: ['wage'], source_verification: 'registry_seed_unverified', }, NLRB: { canonical_entity_id: 'agency_federal_nlrb', agency_name: 'NLRB', display_name: 'National Labor Relations Board', patterns: [/\bNLRB\b/i, /National Labor Relations Board/i], aliases: ['NLRB', 'National Labor Relations Board'], jurisdiction: ['Federal'], domains: ['wage'], source_verification: 'registry_seed_unverified', }, DFPI: { canonical_entity_id: 'agency_ca_dfpi', agency_name: 'DFPI', display_name: 'California Department of Financial Protection and Innovation', patterns: [/\bDFPI\b/i, /Department of Financial Protection and Innovation/i], aliases: ['DFPI'], jurisdiction: ['CA'], domains: ['insurance', 'legal'], source_verification: 'registry_seed_unverified', }, CRD: { canonical_entity_id: 'agency_ca_crd', agency_name: 'CRD', display_name: 'California Civil Rights Department', patterns: [/\bCRD\b/i, /Civil Rights Department/i, /Department of Fair Employment and Housing/i, /\bDFEH\b/i], aliases: ['CRD', 'DFEH', 'Civil Rights Department', 'Department of Fair Employment and Housing'], jurisdiction: ['CA'], domains: ['housing', 'wage', 'legal'], source_verification: 'registry_seed_unverified', }, DLSE: { canonical_entity_id: 'agency_ca_dlse', agency_name: 'DLSE', display_name: 'California Division of Labor Standards Enforcement', patterns: [/\bDLSE\b/i, /Division of Labor Standards Enforcement/i, /Labor Commissioner/i], aliases: ['DLSE', 'Labor Commissioner'], jurisdiction: ['CA'], domains: ['wage'], source_verification: 'registry_seed_unverified', }, EDD: { canonical_entity_id: 'agency_ca_edd', agency_name: 'EDD', display_name: 'California Employment Development Department', patterns: [/\bEDD\b/i, /Employment Development Department/i], aliases: ['EDD', 'Employment Development Department'], jurisdiction: ['CA'], domains: ['benefits'], source_verification: 'registry_seed_unverified', }, });

const DOMAIN_KEYWORDS = Object.freeze({ housing: [ 'eviction', 'rent', 'lease', 'foreclosure', 'housing', 'landlord', 'tenant', 'property', 'mortgage', 'homeowner', 'habitability', 'uninhabitable', 'housing violation', 'rent strike', 'code enforcement', ], wage: [ 'wage', 'salary', 'overtime', 'labor', 'wage theft', 'unpaid', 'paycheck', 'employment', 'employee', 'hour', 'compensation', 'retaliation', 'wage and hour', 'labor commissioner', 'workplace', ], benefits: [ 'unemployment', 'workers comp', 'workers compensation', 'disability', 'benefit', 'social security', 'medicare', 'medicaid', 'denied', 'appeal', 'public assistance', 'snap', 'food stamps', ], insurance: [ 'insurance', 'claim', 'claim denied', 'coverage denied', 'coverage', 'premium', 'policy', 'deductible', 'appeal', 'insurer', ], healthcare: [ 'medical', 'healthcare', 'health care', 'hospital', 'doctor', 'provider', 'treatment', 'diagnosis', 'prescription', 'denied treatment', ], legal: [ 'attorney', 'lawyer', 'court', 'lawsuit', 'litigation', 'complaint', 'appeal', 'motion', 'petition', 'hearing', ], });

const WORKFLOW_KEYWORDS = Object.freeze({ insurance_denial: [ ['insurance', 'claim denied'], ['coverage denied'], ['appeal', 'insurance'], ['insurer', 'appeal'], ], housing_violation: [ ['eviction'], ['housing violation'], ['uninhabitable'], ['rent strike'], ['housing complaint'], ['housing code'], ['code enforcement', 'housing'], ], wage_theft: [ ['wage theft'], ['unpaid wages'], ['wage dispute'], ['labor complaint'], ['wage and hour'], ['labor commissioner'], ['overtime', 'unpaid'], ], benefits_denial: [ ['unemployment denied'], ['workers compensation'], ['workers comp'], ['benefits appeal'], ['benefit denial'], ['ui appeal'], ['disability appeal'], ], });

const JURISDICTION_PATTERNS = Object.freeze({ CA: [/\bcalifornia\b/i, /\bCA\b/, /\bCal.\b/i], NY: [/\bnew york\b/i, /\bNY\b/], TX: [/\btexas\b/i, /\bTX\b/], FL: [/\bflorida\b/i, /\bFL\b/], WA: [/\bwashington\b/i, /\bWA\b/], Federal: [/\bfederal\b/i, /\bunited states\b/i, /\bU.S.\b/i, /\bUS\b/, /\bcongress\b/i, /\bfederal law\b/i], });

const PROCEDURAL_STAGE_KEYWORDS = Object.freeze({ intake: ['apply', 'application', 'intake', 'submit', 'file', 'initial complaint', 'report'], appeal: ['appeal', 'reconsideration', 'review request', 'challenge determination'], hearing: ['hearing', 'administrative hearing', 'appeals hearing', 'tribunal'], escalation: ['grievance', 'ombudsman', 'supervisor review', 'civil rights complaint', 'court filing'], });

// ============================================================================ // MODEL CLASSES // ============================================================================

class Match { constructor({ type, value, position, metadata = {} }) { this.type = type; this.value = value; this.position = position; this.metadata = metadata; this.match_hash = stableId('match', [type, value, position]); } }

class ContextBlock { constructor({ match, text, startIdx, endIdx, source_hash }) { this.match = match; this.text = text; this.startIdx = startIdx; this.endIdx = endIdx; this.source_hash = source_hash; this.context_hash = stableId('context', [source_hash, startIdx, endIdx, text]); }

overlaps(other) { return !(this.endIdx < other.startIdx || this.startIdx > other.endIdx); }

merge(other, fullPayload) { const mergedStart = Math.min(this.startIdx, other.startIdx); const mergedEnd = Math.max(this.endIdx, other.endIdx); return new ContextBlock({ match: this.match, text: fullPayload.slice(mergedStart, mergedEnd), startIdx: mergedStart, endIdx: mergedEnd, source_hash: this.source_hash, }); } }

class Candidate { constructor({ candidate_type, value, confidence, matched_terms = [], metadata = {} }) { this.candidate_type = candidate_type; this.value = value; this.confidence = confidence; this.matched_terms = matched_terms; this.metadata = metadata; this.candidate_id = stableId('candidate', [candidate_type, value, matched_terms, metadata]); } }

class ProtoForm { constructor({ source_hash, context_hash }) { this.proto_form_id = stableId('proto_form', [source_hash, context_hash, ENGINE_METADATA.engine_version]); this.source_hash = source_hash; this.context_hash = context_hash;

this.form_name = null;
this.form_name_strategy = null;
this.normalized_form_key = null;

this.submission_url = null;
this.normalized_submission_url = null;
this.submission_method = 'unknown';

this.agency_name = null;
this.canonical_agency_entity_id = null;
this.agency_candidates = [];

this.jurisdiction = null;
this.jurisdiction_candidates = [];

this.domain_candidates = [];
this.workflow_candidates = [];
this.procedural_stage_candidates = [];

this.deadline_text = null;
this.deadline_value = null;
this.deadline_unit = null;
this.deadline_in_days = null;
this.deadline_raw_match = null;
this.deadline_confidence = 0;

this.raw_context = null;
this.context_excerpt = null;
this.context_start_idx = null;
this.context_end_idx = null;

this.confidence_score = 0;
this.review_status = 'pending_enrichment';
this.verification_status = 'unverified_extraction';
this.source_verification = 'source_text_not_live_verified';

this.validation_flags = {
  missing_url: false,
  missing_agency: false,
  missing_workflow: false,
  missing_domain: false,
  low_confidence: false,
  multiple_domains: false,
  multiple_workflows: false,
  multiple_agencies: false,
  has_deadline: false,
  deadline_unit_not_days: false,
  ambiguous_jurisdiction: false,
  requires_live_url_verification: false,
  requires_registry_entity_resolution: false,
};

this.parser_metadata = {
  ...ENGINE_METADATA,
  generated_at: new Date().toISOString(),
};

} }

class ExtractionResult { constructor({ source_hash, source_descriptor }) { this.engine_metadata = { ...ENGINE_METADATA }; this.source_descriptor = source_descriptor; this.source_hash = source_hash; this.extraction_run_id = stableId('form_extraction_run', [source_hash, ENGINE_METADATA.engine_version, Date.now()]);

this.proto_forms = [];
this.top_forms = [];
this.workflow_counts = {};
this.missing_coverage = {};
this.staging_output = {
  forms_registry_staging: [],
  agency_candidates: [],
  workflow_form_links_staging: [],
  domain_candidates_staging: [],
  procedural_deadlines_staging: [],
  extraction_provenance: [],
  validation_review_queue: [],
};
this.stats = {
  total: 0,
  high_confidence_total: 0,
  avg_confidence: 0,
  by_domain: {},
  by_workflow: {},
  by_jurisdiction: {},
  by_review_status: {},
};

} }

// ============================================================================ // SCANNER MODULE // ============================================================================

class ScannerModule { constructor({ agencyRegistry = AGENCY_REGISTRY } = {}) { this.agencyRegistry = agencyRegistry;

this.actionKeywords = [
  'apply', 'file', 'submit', 'complaint', 'appeal', 'request', 'hearing',
  'petition', 'intake', 'report', 'grievance', 'claim', 'dispute',
  'challenge', 'objection', 'reconsideration', 'determination',
];

this.formIndicators = [
  'form', 'request', 'application', 'complaint', 'appeal', 'notice',
  'filing', 'petition', 'claim form', 'complaint form', 'hearing request',
];

this.urlPatterns = [
  /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
  /www\.[^\s<>"{}|\\^`]+/gi,
  /\b[a-zA-Z0-9.-]+\.(?:gov|org|com|edu|net|us)(?:\/[^\s<>"{}|\\^`\[\]]*)?/gi,
];

this.phonePattern = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
this.addressPattern = /\d+\s+[a-z0-9.'\-\s]+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|way|walk|circle|cir)\b[^.\n]*/gi;

this.deadlinePatterns = [
  { pattern: /within\s+(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
  { pattern: /no\s+later\s+than\s+(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
  { pattern: /must\s+(?:file|submit|appeal|apply)\s+(?:your\s+)?(?:appeal|complaint|claim|application)?\s*within\s+(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
  { pattern: /deadline\s+(?:is|of|:)?\s*(?:no\s+later\s+than\s+)?(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
  { pattern: /appeal\s+within\s+(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
  { pattern: /file\s+(?:your\s+)?(?:appeal|complaint|claim)\s+within\s+(\d+)\s+(business\s+days?|days?|weeks?|months?|years?)\b/gi, unitGroup: 2 },
];

}

scan(payload) { const matches = [];

for (const pattern of this.urlPatterns) {
  const regex = cloneRegex(pattern);
  let match;
  while ((match = regex.exec(payload)) !== null) {
    matches.push(new Match({
      type: 'url',
      value: match[0],
      position: match.index,
      metadata: { normalized_url: normalizeUrl(match[0]) },
    }));
  }
}

let phoneMatch;
const phoneRegex = cloneRegex(this.phonePattern);
while ((phoneMatch = phoneRegex.exec(payload)) !== null) {
  matches.push(new Match({ type: 'phone', value: phoneMatch[0], position: phoneMatch.index }));
}

let addressMatch;
const addressRegex = cloneRegex(this.addressPattern);
while ((addressMatch = addressRegex.exec(payload)) !== null) {
  matches.push(new Match({ type: 'address', value: addressMatch[0].trim(), position: addressMatch.index }));
}

for (const keyword of this.actionKeywords) {
  const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  let match;
  while ((match = regex.exec(payload)) !== null) {
    matches.push(new Match({ type: 'action_keyword', value: keyword, position: match.index }));
  }
}

for (const indicator of this.formIndicators) {
  const regex = new RegExp(`\\b${indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  let match;
  while ((match = regex.exec(payload)) !== null) {
    matches.push(new Match({ type: 'form_indicator', value: indicator, position: match.index }));
  }
}

for (const { pattern, unitGroup } of this.deadlinePatterns) {
  const regex = cloneRegex(pattern);
  let match;
  while ((match = regex.exec(payload)) !== null) {
    matches.push(new Match({
      type: 'deadline',
      value: match[0],
      position: match.index,
      metadata: {
        value: Number.parseInt(match[1], 10),
        unit: match[unitGroup],
      },
    }));
  }
}

return uniqueBy(matches, m => `${m.type}|${m.value}|${m.position}`).sort((a, b) => a.position - b.position);

}

detectAgencies(text) { const candidates = [];

for (const [registryKey, agency] of Object.entries(this.agencyRegistry)) {
  for (const pattern of agency.patterns) {
    if (testRegex(pattern, text)) {
      candidates.push(new Candidate({
        candidate_type: 'agency',
        value: agency.agency_name || registryKey,
        confidence: 0.9,
        matched_terms: [pattern.source],
        metadata: {
          canonical_entity_id: agency.canonical_entity_id,
          display_name: agency.display_name,
          aliases: agency.aliases,
          jurisdiction: agency.jurisdiction,
          domains: agency.domains,
          source_verification: agency.source_verification,
        },
      }));
      break;
    }
  }
}

return candidates.sort((a, b) => b.confidence - a.confidence);

}

detectJurisdictions(text) { const candidates = [];

for (const [jurisdiction, patterns] of Object.entries(JURISDICTION_PATTERNS)) {
  const matched = patterns.filter(pattern => testRegex(pattern, text)).map(pattern => pattern.source);
  if (matched.length > 0) {
    candidates.push(new Candidate({
      candidate_type: 'jurisdiction',
      value: jurisdiction,
      confidence: Math.min(0.5 + matched.length * 0.2, 0.95),
      matched_terms: matched,
    }));
  }
}

return candidates.sort((a, b) => b.confidence - a.confidence);

}

detectDomainCandidates(text) { const candidates = []; const lower = text.toLowerCase();

for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
  const matched = keywords.filter(keyword => lower.includes(keyword.toLowerCase()));
  if (matched.length > 0) {
    candidates.push(new Candidate({
      candidate_type: 'domain',
      value: domain,
      confidence: Math.min(0.35 + matched.length * 0.15, 0.95),
      matched_terms: matched,
      metadata: { match_count: matched.length },
    }));
  }
}

return candidates.sort((a, b) => b.confidence - a.confidence);

}

detectWorkflowCandidates(text, jurisdictionCandidates = []) { const candidates = []; const lower = text.toLowerCase();

for (const [workflow, keywordGroups] of Object.entries(WORKFLOW_KEYWORDS)) {
  for (const group of keywordGroups) {
    const matched = group.filter(keyword => lower.includes(keyword.toLowerCase()));
    if (matched.length === group.length) {
      candidates.push(new Candidate({
        candidate_type: 'workflow',
        value: workflow,
        confidence: Math.min(0.65 + group.length * 0.1, 0.95),
        matched_terms: group,
        metadata: { jurisdiction_prefix_applied: false },
      }));
    }
  }
}

const hasCA = jurisdictionCandidates.some(c => c.value === 'CA');
if (hasCA) {
  const caCandidates = candidates
    .filter(c => !String(c.value).startsWith('ca_'))
    .map(c => new Candidate({
      candidate_type: 'workflow',
      value: `ca_${c.value}`,
      confidence: Math.min(c.confidence + 0.02, 0.97),
      matched_terms: c.matched_terms,
      metadata: { ...c.metadata, jurisdiction_prefix_applied: true, base_workflow: c.value },
    }));
  candidates.push(...caCandidates);
}

return uniqueBy(candidates, c => c.value).sort((a, b) => b.confidence - a.confidence);

}

detectProceduralStages(text) { const candidates = []; const lower = text.toLowerCase();

for (const [stage, keywords] of Object.entries(PROCEDURAL_STAGE_KEYWORDS)) {
  const matched = keywords.filter(keyword => lower.includes(keyword.toLowerCase()));
  if (matched.length > 0) {
    candidates.push(new Candidate({
      candidate_type: 'procedural_stage',
      value: stage,
      confidence: Math.min(0.45 + matched.length * 0.15, 0.9),
      matched_terms: matched,
    }));
  }
}

return candidates.sort((a, b) => b.confidence - a.confidence);

}

extractDeadline(text) { for (const { pattern, unitGroup } of this.deadlinePatterns) { const regex = cloneRegex(pattern); const match = regex.exec(text); if (!match) continue;

const value = Number.parseInt(match[1], 10);
  const unit = String(match[unitGroup] || 'days').toLowerCase();
  const deadlineInDays = this.convertDeadlineToDays(value, unit);

  return {
    deadline_text: match[0],
    deadline_value: value,
    deadline_unit: unit,
    deadline_in_days: deadlineInDays,
    deadline_raw_match: match[0],
    deadline_confidence: unit.includes('business') ? 0.75 : 0.85,
  };
}

return {
  deadline_text: null,
  deadline_value: null,
  deadline_unit: null,
  deadline_in_days: null,
  deadline_raw_match: null,
  deadline_confidence: 0,
};

}

convertDeadlineToDays(value, unit) { if (!Number.isFinite(value)) return null; if (/business\s+day/.test(unit)) return value; if (/day/.test(unit)) return value; if (/week/.test(unit)) return value * 7; if (/month/.test(unit)) return value * 30; if (/year/.test(unit)) return value * 365; return value; } }

// ============================================================================ // CONTEXT EXTRACTOR MODULE // ============================================================================

class ContextExtractorModule { constructor({ contextWindow = DEFAULT_CONTEXT_WINDOW } = {}) { this.contextWindow = contextWindow; }

extract(payload, matches, source_hash) { const blocks = matches.map(match => { const startIdx = Math.max(0, match.position - this.contextWindow); const endIdx = Math.min(payload.length, match.position + String(match.value).length + this.contextWindow); return new ContextBlock({ match, text: payload.slice(startIdx, endIdx), startIdx, endIdx, source_hash, }); });

return this.mergeOverlapping(blocks, payload);

}

mergeOverlapping(blocks, payload) { if (!blocks.length) return [];

const sorted = [...blocks].sort((a, b) => a.startIdx - b.startIdx);
const merged = [sorted[0]];

for (let i = 1; i < sorted.length; i++) {
  const last = merged[merged.length - 1];
  const current = sorted[i];

  if (last.overlaps(current)) {
    merged[merged.length - 1] = last.merge(current, payload);
  } else {
    merged.push(current);
  }
}

return merged;

} }

// ============================================================================ // PROTO-FORM BUILDER MODULE // ============================================================================

class ProtoFormBuilderModule { constructor({ scanner }) { this.scanner = scanner; }

build(contextBlocks) { return contextBlocks.map(block => this.buildOne(block)); }

buildOne(block) { const context = block.text; const form = new ProtoForm({ source_hash: block.source_hash, context_hash: block.context_hash });

const formName = this.extractFormName(context);
form.form_name = formName ? formName.name : null;
form.form_name_strategy = formName ? formName.strategy : null;
form.normalized_form_key = form.form_name ? normalizeName(form.form_name) : null;

form.submission_url = this.extractSubmissionUrl(context);
form.normalized_submission_url = normalizeUrl(form.submission_url);
form.submission_method = this.determineSubmissionMethod(context);

form.agency_candidates = this.scanner.detectAgencies(context);
const primaryAgency = firstOrNull(form.agency_candidates);
form.agency_name = primaryAgency ? primaryAgency.value : null;
form.canonical_agency_entity_id = primaryAgency ? primaryAgency.metadata.canonical_entity_id : null;

form.jurisdiction_candidates = this.scanner.detectJurisdictions(context);
const primaryJurisdiction = firstOrNull(form.jurisdiction_candidates);
form.jurisdiction = primaryJurisdiction ? primaryJurisdiction.value : null;

form.domain_candidates = this.scanner.detectDomainCandidates(context);
form.workflow_candidates = this.scanner.detectWorkflowCandidates(context, form.jurisdiction_candidates);
form.procedural_stage_candidates = this.scanner.detectProceduralStages(context);

const deadline = this.scanner.extractDeadline(context);
Object.assign(form, deadline);

form.raw_context = context;
form.context_excerpt = normalizeWhitespace(context).slice(0, 500);
form.context_start_idx = block.startIdx;
form.context_end_idx = block.endIdx;

form.confidence_score = this.calculateConfidence(form);
form.review_status = this.determineReviewStatus(form);
form.validation_flags = this.calculateValidationFlags(form);

return form;

}

extractFormName(context) { const lines = context.split('\n').map(line => line.trim()).filter(Boolean);

const explicitPatterns = [
  /\b([A-Z][A-Z0-9\s\-/&]{3,80}\b(?:FORM|COMPLAINT|APPEAL|APPLICATION|REQUEST|NOTICE|PETITION)\b[A-Z0-9\s\-/&]*)/,
  /\b((?:Form|Request|Application|Complaint|Appeal|Notice|Filing|Petition)\s+(?:No\.|#)?[A-Z0-9\-\s/&]{2,80})/i,
  /\b([A-Z][A-Za-z\s\-/&]{2,80}\s+(?:Form|Complaint|Appeal|Application|Request|Notice|Petition))\b/,
];

for (const pattern of explicitPatterns) {
  const match = context.match(pattern);
  if (match) {
    return { name: normalizeWhitespace(match[1]), strategy: 'explicit_form_heading' };
  }
}

const urlLineIdx = lines.findIndex(line => /https?:\/\/|www\.|\.(gov|org|com|edu|net|us)\b/i.test(line));
if (urlLineIdx !== -1) {
  for (let i = Math.max(0, urlLineIdx - 4); i <= Math.min(lines.length - 1, urlLineIdx + 1); i++) {
    const line = lines[i];
    if (/^[A-Z][A-Za-z0-9\s\-/&]{5,90}$/.test(line) && !/https?:\/\//.test(line)) {
      return { name: normalizeWhitespace(line), strategy: 'heading_near_url' };
    }
  }
}

const actionWords = ['apply', 'file', 'submit', 'complaint', 'appeal', 'request'];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (actionWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(line))) {
    for (let j = Math.max(0, i - 5); j < i; j++) {
      const prior = lines[j];
      if (/^[A-Z]/.test(prior) && prior.length > 5 && prior.length < 100) {
        return { name: normalizeWhitespace(prior), strategy: 'label_before_action' };
      }
    }
  }
}

return null;

}

extractSubmissionUrl(context) { const match = context.match(/https?://[^\s<>"{}|\^]+|www\.[^\s<>"{}|\\^[]]+|\b[a-zA-Z0-9.-]+.(?:gov|org|com|edu|net|us)(?:/[^\s<>"{}|\^`]*)?/i); return match ? match[0].replace(/[).,;:]+$/g, '') : null; }

determineSubmissionMethod(context) { const hasUrl = /https?://|www.|.(gov|org|com|edu|net|us)\b/i.test(context); const hasPhone = /(?:+?1[-.\s]?)??[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/.test(context); const hasAddress = /\d+\s+[a-z0-9.'-\s]+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|pl|place|way|walk|circle|cir)\b/i.test(context);

if (hasUrl) return 'online';
if (hasPhone) return 'phone';
if (hasAddress) return 'mail_or_in_person';
return 'unknown';

}

calculateConfidence(form) { let score = 0; if (form.normalized_submission_url) score += 1; if (form.workflow_candidates.length > 0) score += 1; if (form.agency_candidates.length > 0) score += 1; if (form.domain_candidates.length > 0) score += 1; if (form.form_name) score += 1; if (form.deadline_in_days !== null) score += 0.5; if (form.procedural_stage_candidates.length > 0) score += 0.5; return Math.min(score, 6); }

determineReviewStatus(form) { if (form.confidence_score >= 4 && form.normalized_submission_url && form.agency_name) return 'pending_live_verification'; if (form.confidence_score >= DEFAULT_CONFIDENCE_THRESHOLD) return 'pending_review'; return 'pending_enrichment'; }

calculateValidationFlags(form) { return { missing_url: !form.normalized_submission_url, missing_agency: form.agency_candidates.length === 0, missing_workflow: form.workflow_candidates.length === 0, missing_domain: form.domain_candidates.length === 0, low_confidence: form.confidence_score < 2, multiple_domains: form.domain_candidates.length > 1, multiple_workflows: form.workflow_candidates.length > 1, multiple_agencies: form.agency_candidates.length > 1, has_deadline: form.deadline_in_days !== null, deadline_unit_not_days: !!form.deadline_unit && !/day/.test(form.deadline_unit), ambiguous_jurisdiction: form.jurisdiction_candidates.length > 1, requires_live_url_verification: !!form.normalized_submission_url, requires_registry_entity_resolution: !form.canonical_agency_entity_id && form.agency_candidates.length > 0, }; } }

// ============================================================================ // DEDUPLICATION MODULE // ============================================================================

class DeduplicationModule { deduplicate(forms) { const groups = new Map();

for (const form of forms) {
  const key = this.generateCompositeKey(form);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(form);
}

const deduped = [];

for (const groupForms of groups.values()) {
  if (groupForms.length === 1) {
    deduped.push(groupForms[0]);
    continue;
  }

  const sorted = [...groupForms].sort((a, b) => b.confidence_score - a.confidence_score);
  const primary = sorted[0];

  primary.workflow_candidates = uniqueBy(groupForms.flatMap(f => f.workflow_candidates), c => c.value);
  primary.domain_candidates = uniqueBy(groupForms.flatMap(f => f.domain_candidates), c => c.value);
  primary.agency_candidates = uniqueBy(groupForms.flatMap(f => f.agency_candidates), c => c.value);
  primary.jurisdiction_candidates = uniqueBy(groupForms.flatMap(f => f.jurisdiction_candidates), c => c.value);
  primary.procedural_stage_candidates = uniqueBy(groupForms.flatMap(f => f.procedural_stage_candidates), c => c.value);

  primary.deduplication = {
    group_size: groupForms.length,
    merged_proto_form_ids: groupForms.map(f => f.proto_form_id),
    dedupe_key: this.generateCompositeKey(primary),
  };

  deduped.push(primary);
}

return deduped;

}

generateCompositeKey(form) { const url = form.normalized_submission_url || 'no_url'; const name = form.normalized_form_key || 'no_name'; const agency = form.canonical_agency_entity_id || form.agency_name || 'no_agency'; const workflow = firstOrNull(form.workflow_candidates)?.value || 'no_workflow'; const stage = firstOrNull(form.procedural_stage_candidates)?.value || 'no_stage'; return ${url}|${name}|${agency}|${workflow}|${stage}; } }

// ============================================================================ // STAGING OUTPUT MODULE // ============================================================================

class StagingOutputModule { generate(forms, result) { const formsRegistryStaging = []; const agencyCandidates = []; const workflowLinks = []; const domainCandidates = []; const proceduralDeadlines = []; const extractionProvenance = []; const validationReviewQueue = [];

for (const form of forms) {
  formsRegistryStaging.push({
    proto_form_id: form.proto_form_id,
    extraction_run_id: result.extraction_run_id,
    schema_version: ENGINE_METADATA.schema_version,
    form_name: form.form_name,
    form_name_strategy: form.form_name_strategy,
    normalized_form_key: form.normalized_form_key,
    submission_url: form.submission_url,
    normalized_submission_url: form.normalized_submission_url,
    submission_method: form.submission_method,
    agency_name: form.agency_name,
    canonical_agency_entity_id: form.canonical_agency_entity_id,
    jurisdiction: form.jurisdiction,
    primary_domain: firstOrNull(form.domain_candidates)?.value || null,
    primary_workflow: firstOrNull(form.workflow_candidates)?.value || null,
    primary_procedural_stage: firstOrNull(form.procedural_stage_candidates)?.value || null,
    deadline_in_days: form.deadline_in_days,
    deadline_unit: form.deadline_unit,
    deadline_raw_match: form.deadline_raw_match,
    confidence_score: form.confidence_score,
    review_status: form.review_status,
    verification_status: form.verification_status,
    source_verification: form.source_verification,
    validation_flags: form.validation_flags,
    context_hash: form.context_hash,
    source_hash: form.source_hash,
    context_excerpt: form.context_excerpt,
    raw_context: form.raw_context,
    parser_metadata: form.parser_metadata,
    ingestion_timestamp: new Date().toISOString(),
  });

  for (const agency of form.agency_candidates) {
    agencyCandidates.push({
      proto_form_id: form.proto_form_id,
      agency_name: agency.value,
      canonical_agency_entity_id: agency.metadata.canonical_entity_id || null,
      display_name: agency.metadata.display_name || null,
      aliases: agency.metadata.aliases || [],
      jurisdiction: agency.metadata.jurisdiction || [],
      domains: agency.metadata.domains || [],
      confidence: agency.confidence,
      matched_terms: agency.matched_terms,
      source_verification: agency.metadata.source_verification || 'unknown',
    });
  }

  for (const workflow of form.workflow_candidates) {
    workflowLinks.push({
      proto_form_id: form.proto_form_id,
      workflow_hint: workflow.value,
      matched_terms: workflow.matched_terms,
      confidence: workflow.confidence,
      is_jurisdiction_prefixed: !!workflow.metadata.jurisdiction_prefix_applied,
      base_workflow: workflow.metadata.base_workflow || workflow.value,
    });
  }

  for (const domain of form.domain_candidates) {
    domainCandidates.push({
      proto_form_id: form.proto_form_id,
      domain: domain.value,
      confidence: domain.confidence,
      matched_terms: domain.matched_terms,
      match_count: domain.metadata.match_count || domain.matched_terms.length,
    });
  }

  if (form.deadline_in_days !== null) {
    proceduralDeadlines.push({
      proto_form_id: form.proto_form_id,
      deadline_text: form.deadline_text,
      deadline_value: form.deadline_value,
      deadline_unit: form.deadline_unit,
      deadline_in_days: form.deadline_in_days,
      deadline_raw_match: form.deadline_raw_match,
      confidence: form.deadline_confidence,
      requires_legal_verification: true,
    });
  }

  extractionProvenance.push({
    proto_form_id: form.proto_form_id,
    extraction_run_id: result.extraction_run_id,
    source_hash: form.source_hash,
    context_hash: form.context_hash,
    context_start_idx: form.context_start_idx,
    context_end_idx: form.context_end_idx,
    engine_id: ENGINE_METADATA.engine_id,
    engine_version: ENGINE_METADATA.engine_version,
    schema_version: ENGINE_METADATA.schema_version,
    deterministic: true,
  });

  if (Object.values(form.validation_flags).some(Boolean)) {
    validationReviewQueue.push({
      proto_form_id: form.proto_form_id,
      review_status: form.review_status,
      validation_flags: form.validation_flags,
      confidence_score: form.confidence_score,
      priority: this.determineReviewPriority(form),
      reason: this.reviewReason(form),
    });
  }
}

return {
  forms_registry_staging: formsRegistryStaging,
  agency_candidates: agencyCandidates,
  workflow_form_links_staging: workflowLinks,
  domain_candidates_staging: domainCandidates,
  procedural_deadlines_staging: proceduralDeadlines,
  extraction_provenance: extractionProvenance,
  validation_review_queue: validationReviewQueue,
};

}

determineReviewPriority(form) { if (form.deadline_in_days !== null && form.deadline_in_days <= 30) return 'high'; if (form.confidence_score >= 4 && form.normalized_submission_url) return 'medium'; if (form.validation_flags.missing_workflow || form.validation_flags.missing_agency) return 'medium'; return 'low'; }

reviewReason(form) { const reasons = []; for (const [flag, value] of Object.entries(form.validation_flags)) { if (value) reasons.push(flag); } return reasons.join(', '); } }

// ============================================================================ // MAIN ENGINE // ============================================================================

class FormSignalExtractionEngine { constructor(options = {}) { this.options = { contextWindow: options.contextWindow || DEFAULT_CONTEXT_WINDOW, confidenceThreshold: options.confidenceThreshold || DEFAULT_CONFIDENCE_THRESHOLD, agencyRegistry: options.agencyRegistry || AGENCY_REGISTRY, };

this.scanner = new ScannerModule({ agencyRegistry: this.options.agencyRegistry });
this.contextExtractor = new ContextExtractorModule({ contextWindow: this.options.contextWindow });
this.protoFormBuilder = new ProtoFormBuilderModule({ scanner: this.scanner });
this.deduplicator = new DeduplicationModule();
this.stagingOutput = new StagingOutputModule();

}

extract(payload, sourceDescriptor = {}) { if (typeof payload !== 'string') { throw new TypeError('FormSignalExtractionEngine.extract(payload) requires payload to be a string.'); }

const source_hash = sha256(payload);
const result = new ExtractionResult({ source_hash, source_descriptor: sourceDescriptor });

const matches = this.scanner.scan(payload);
const contextBlocks = this.contextExtractor.extract(payload, matches, source_hash);
let protoForms = this.protoFormBuilder.build(contextBlocks);
protoForms = this.deduplicator.deduplicate(protoForms);

result.proto_forms = protoForms;
result.top_forms = protoForms.filter(form => form.confidence_score >= this.options.confidenceThreshold);
result.workflow_counts = this.calculateWorkflowCounts(protoForms);
result.missing_coverage = this.detectMissingCoverage(protoForms);
result.staging_output = this.stagingOutput.generate(protoForms, result);
result.stats = this.calculateStats(protoForms, result.top_forms);

return result;

}

calculateWorkflowCounts(forms) { const counts = {}; for (const form of forms) { for (const workflow of form.workflow_candidates) { counts[workflow.value] = (counts[workflow.value] || 0) + 1; } } return counts; }

calculateStats(forms, topForms) { const byDomain = {}; const byWorkflow = {}; const byJurisdiction = {}; const byReviewStatus = {};

for (const form of forms) {
  for (const domain of form.domain_candidates) {
    byDomain[domain.value] = (byDomain[domain.value] || 0) + 1;
  }
  for (const workflow of form.workflow_candidates) {
    byWorkflow[workflow.value] = (byWorkflow[workflow.value] || 0) + 1;
  }
  for (const jurisdiction of form.jurisdiction_candidates) {
    byJurisdiction[jurisdiction.value] = (byJurisdiction[jurisdiction.value] || 0) + 1;
  }
  byReviewStatus[form.review_status] = (byReviewStatus[form.review_status] || 0) + 1;
}

return {
  total: forms.length,
  high_confidence_total: topForms.length,
  avg_confidence: forms.length ? forms.reduce((sum, form) => sum + form.confidence_score, 0) / forms.length : 0,
  by_domain: byDomain,
  by_workflow: byWorkflow,
  by_jurisdiction: byJurisdiction,
  by_review_status: byReviewStatus,
};

}

detectMissingCoverage(forms) { const expectedWorkflows = [ 'insurance_denial', 'housing_violation', 'wage_theft', 'benefits_denial', 'ca_insurance_denial', 'ca_housing_violation', 'ca_wage_theft', 'ca_benefits_denial', ];

const missing = {};

for (const workflow of expectedWorkflows) {
  const formsWithWorkflow = forms.filter(form =>
    form.workflow_candidates.some(candidate => candidate.value === workflow)
  );

  const hasIntake = formsWithWorkflow.some(form =>
    form.procedural_stage_candidates.some(stage => stage.value === 'intake') || form.domain_candidates.length > 0
  );
  const hasAppeal = formsWithWorkflow.some(form =>
    form.procedural_stage_candidates.some(stage => stage.value === 'appeal') || /appeal/i.test(form.form_name || '')
  );
  const hasEscalation = formsWithWorkflow.some(form =>
    form.procedural_stage_candidates.some(stage => ['hearing', 'escalation'].includes(stage.value)) || /hearing|grievance|ombudsman/i.test(form.form_name || '')
  );
  const hasDeadline = formsWithWorkflow.some(form => form.deadline_in_days !== null);
  const hasVerifiedSourceCandidate = formsWithWorkflow.some(form => !!form.normalized_submission_url);

  missing[workflow] = [];
  if (!hasIntake) missing[workflow].push('no_intake_form');
  if (!hasAppeal) missing[workflow].push('no_appeal_form');
  if (!hasEscalation) missing[workflow].push('no_escalation_path');
  if (!hasDeadline) missing[workflow].push('no_deadline_signal');
  if (!hasVerifiedSourceCandidate) missing[workflow].push('no_live_source_candidate');
}

return missing;

} }

// ============================================================================ // OPTIONAL CLI TEST HARNESS // ============================================================================

if (require.main === module) { const samplePayload = ` CALIFORNIA WAGE THEFT COMPLAINT

You have the right to file a wage theft complaint with the California Labor Commissioner. Online filing: https://www.dir.ca.gov/dlse/ Phone: (888) 866-4886 You must file your complaint within 3 years of the wage violation.

UNEMPLOYMENT INSURANCE APPEAL You must file your appeal within 30 days of receiving the notice of determination. Contact the California EDD: https://www.edd.ca.gov/unemployment-appeal Phone: (888) 353-1545

FEDERAL EEOC COMPLAINT FORM File online at: https://www.eeoc.gov/filing-charge-discrimination Deadline: within 180 days or 300 days in some jurisdictions. `;

const engine = new FormSignalExtractionEngine(); const result = engine.extract(samplePayload, { source_type: 'manual_test_payload', source_name: 'v3_cli_test', });

console.log(JSON.stringify({ engine_metadata: result.engine_metadata, stats: result.stats, top_forms: result.top_forms.map(form => ({ proto_form_id: form.proto_form_id, form_name: form.form_name, submission_url: form.normalized_submission_url, agency_name: form.agency_name, jurisdiction: form.jurisdiction, workflows: form.workflow_candidates.map(w => w.value), domains: form.domain_candidates.map(d => d.value), deadline_in_days: form.deadline_in_days, confidence_score: form.confidence_score, review_status: form.review_status, validation_flags: form.validation_flags, })), staging_counts: Object.fromEntries( Object.entries(result.staging_output).map(([key, value]) => [key, value.length]) ), }, null, 2)); }

module.exports = { FormSignalExtractionEngine, ENGINE_METADATA, AGENCY_REGISTRY, DOMAIN_KEYWORDS, WORKFLOW_KEYWORDS, };
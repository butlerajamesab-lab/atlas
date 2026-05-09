import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });
const schemaDir = path.resolve('src/schema/json');
const validators = new Map();

function loadSchema(name) {
  if (!validators.has(name)) {
    const schemaPath = path.join(schemaDir, name);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    validators.set(name, ajv.compile(schema));
  }
  return validators.get(name);
}

export function validateSchema(name, payload) {
  const validate = loadSchema(name);
  const ok = validate(payload);
  return { ok, errors: ok ? [] : validate.errors };
}

export function normalizeConfidence(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

export function assertSignalIngestRequest(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('body must be an object');
  if (!body?.source_id || typeof body.source_id !== 'string') errors.push('source_id is required');
  if (!body?.jurisdiction_id || typeof body.jurisdiction_id !== 'string') errors.push('jurisdiction_id is required');
  if (!body?.module_hint || typeof body.module_hint !== 'string') errors.push('module_hint is required');
  if (!Array.isArray(body?.signals)) errors.push('signals must be an array');
  return errors;
}

export function assertCreateCursorRequest(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('body must be an object');
  if (!body?.name || typeof body.name !== 'string') errors.push('name is required');
  if (body?.from_offset !== undefined && !Number.isInteger(body.from_offset)) errors.push('from_offset must be an integer when provided');
  if (body?.from_timestamp !== undefined && Number.isNaN(Date.parse(body.from_timestamp))) errors.push('from_timestamp must be an ISO timestamp when provided');
  return errors;
}

export function assertInvestigationTrigger(body) {
  const errors = [];
  const trigger = body?.trigger;
  if (!trigger || typeof trigger !== 'object') errors.push('trigger is required');
  if (!trigger?.stream_id || typeof trigger.stream_id !== 'string') errors.push('trigger.stream_id is required');
  if (!Number.isInteger(trigger?.from_offset)) errors.push('trigger.from_offset is required and must be an integer');
  if (!Number.isInteger(trigger?.to_offset)) errors.push('trigger.to_offset is required and must be an integer');
  if (Number.isInteger(trigger?.from_offset) && Number.isInteger(trigger?.to_offset) && trigger.to_offset < trigger.from_offset) {
    errors.push('trigger.to_offset must be greater than or equal to trigger.from_offset');
  }
  return errors;
}

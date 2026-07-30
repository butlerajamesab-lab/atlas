import { createHash, randomUUID } from 'node:crypto';

export const EVENT_ENTITY_RESOLVER_ID = 'atlas.signal_event_entity_exact';
export const EVENT_ENTITY_RESOLVER_VERSION = '1.0.0';
export const EVENT_ENTITY_RULE_VERSION = '1.0.0';

const FIELD_SEPARATOR = '\u001f';
const ARRAY_SEPARATOR = '\u001e';
const MAX_INDEX_ROWS = 1_000_000;
const INDEX_PAGE_SIZE = 1_000;

export const EVENT_ENTITY_RULE_MANIFEST = Object.freeze([
  {
    rule_id: 'pro_publica.nonprofit_registry_record.subject_nonprofit',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'pro_publica',
    signal_types: ['nonprofit_registry_record'],
    entity_role: 'subject_nonprofit',
    expected_entity_type: 'nonprofit',
    exact_identifier_types: ['ein'],
    name_fields: ['payload.name', 'payload.raw.name', 'payload.raw.sub_name'],
    identifier_fields: ['payload.ein', 'payload.external_id', 'payload.raw.ein'],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'pro_publica.nonprofit_990.subject_nonprofit',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'pro_publica',
    signal_types: ['nonprofit_990', 'nonprofit_990_filing'],
    entity_role: 'subject_nonprofit',
    expected_entity_type: 'nonprofit',
    exact_identifier_types: ['ein'],
    name_fields: ['payload.organization_name', 'payload.name', 'payload.raw.organization_name', 'payload.raw.name'],
    identifier_fields: ['payload.ein', 'payload.raw.ein'],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'cfpb_complaints.complained_against_entity',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'cfpb_complaints',
    signal_types: ['*'],
    entity_role: 'complained_against_entity',
    expected_entity_type: 'organization',
    exact_identifier_types: [],
    name_fields: ['payload.company', 'payload.employer'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'eeoc_filings.respondent_employer',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'eeoc_filings',
    signal_types: ['*'],
    entity_role: 'respondent_employer',
    expected_entity_type: 'organization',
    exact_identifier_types: [],
    name_fields: ['payload.employer'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'sec_edgar.issuer',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'sec_edgar',
    signal_types: ['*'],
    entity_role: 'issuer',
    expected_entity_type: 'organization',
    exact_identifier_types: ['cik'],
    name_fields: ['payload.company'],
    identifier_fields: ['payload.cik'],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'regulations_gov.issuing_agency',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'regulations_gov',
    signal_types: ['*'],
    entity_role: 'issuing_agency',
    expected_entity_type: 'government_agency',
    exact_identifier_types: [],
    name_fields: ['payload.agency', 'payload.agency_name'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'usa_spending.award_recipient',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'usa_spending',
    signal_types: ['*'],
    entity_role: 'award_recipient',
    expected_entity_type: 'organization',
    exact_identifier_types: ['uei', 'duns'],
    name_fields: ['payload.recipient_name', 'payload.recipient', 'payload.award_recipient', 'payload.recipient_legal_entity_name', 'payload.title'],
    identifier_fields: ['payload.recipient_uei', 'payload.uei', 'payload.recipient_duns', 'payload.duns'],
    transform: 'first_exact_field_or_contract_title_recipient_prefix',
  },
  {
    rule_id: 'usa_spending.awarding_agency',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'usa_spending',
    signal_types: ['*'],
    entity_role: 'awarding_agency',
    expected_entity_type: 'government_agency',
    exact_identifier_types: [],
    name_fields: ['payload.agency', 'payload.awarding_agency_name'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'grants_gov.granting_agency',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'grants_gov',
    signal_types: ['*'],
    entity_role: 'granting_agency',
    expected_entity_type: 'government_agency',
    exact_identifier_types: [],
    name_fields: ['payload.agency', 'payload.agency_name'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'open_states.legislative_sponsor',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: 'open_states',
    signal_types: ['*'],
    entity_role: 'legislative_sponsor',
    expected_entity_type: 'person',
    exact_identifier_types: [],
    name_fields: ['payload.sponsor', 'payload.sponsor_name', 'payload.sponsors[*]'],
    identifier_fields: [],
    transform: 'direct_or_array_exact_sponsor_name',
  },
  {
    rule_id: 'generic.canonical_entity_id',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: '*',
    signal_types: ['*'],
    entity_role: 'subject_entity',
    expected_entity_type: null,
    exact_identifier_types: ['canonical_entity_id'],
    name_fields: ['payload.entity_name', 'payload.entity'],
    identifier_fields: ['payload.canonical_entity_id'],
    transform: 'exact_canonical_entity_id',
  },
  {
    rule_id: 'generic.declared_subject_field',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: '*',
    signal_types: ['*'],
    entity_role: 'subject_entity',
    expected_entity_type: null,
    exact_identifier_types: [],
    name_fields: ['payload.entity_name', 'payload.entity'],
    identifier_fields: [],
    transform: 'first_non_empty_exact_field',
  },
  {
    rule_id: 'system.no_declared_entity_rule',
    rule_version: EVENT_ENTITY_RULE_VERSION,
    stream_id: '*',
    signal_types: ['*'],
    entity_role: 'none',
    expected_entity_type: null,
    exact_identifier_types: [],
    name_fields: [],
    identifier_fields: [],
    transform: 'explicit_ignored_outcome',
  },
]);

const RULE_BY_ID = new Map(EVENT_ENTITY_RULE_MANIFEST.map((rule) => [rule.rule_id, rule]));

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized.length > 0) return normalized;
  }
  return null;
}

function sortedUnique(values) {
  return [...new Set(Array.from(values ?? [])
    .filter((value) => value !== null && value !== undefined)
    .map(String))]
    .sort();
}

function stableValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key]);
    return result;
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export const EVENT_ENTITY_RULE_MANIFEST_HASH = sha256Text(stableStringify(EVENT_ENTITY_RULE_MANIFEST));

/**
 * Matches Atlas's deployed engine_extract_entity canonical-name normalization:
 * Trim -> uppercase -> remove every character outside ASCII A-Z / 0-9.
 * This is exact canonical normalization, not fuzzy similarity.
 */
export function normalizeEntityName(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized || null;
}

export function normalizeIdentifier(identifierType, value) {
  if (value === undefined || value === null) return null;
  const type = String(identifierType ?? 'generic').toLowerCase();
  const raw = String(value).normalize('NFKC').trim();
  if (!raw) return null;

  if (type === 'canonical_entity_id') return raw;

  if (type === 'ein') {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 9 ? digits : null;
  }
  if (type === 'cik') {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 1 && digits.length <= 10 ? digits.padStart(10, '0') : null;
  }
  if (type === 'duns') {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 9 ? digits : null;
  }
  if (type === 'uei') {
    const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return compact.length === 12 ? compact : null;
  }

  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact || null;
}

const ORGANIZATION_ENTITY_TYPES = new Set([
  'organization',
  'corporation',
  'nonprofit',
  'political_committee',
  'government_agency',
  'financial_institution',
  'telecom_company',
  'media_company',
  'contractor_business',
  'landlord_entity',
]);

export function isEntityTypeCompatible(expectedEntityType, actualEntityType) {
  if (!expectedEntityType) return true;
  const expected = String(expectedEntityType).toLowerCase();
  const actual = String(actualEntityType ?? '').toLowerCase();
  if (!actual) return false;
  if (expected === actual) return true;
  if (expected === 'organization') return ORGANIZATION_ENTITY_TYPES.has(actual);
  if (expected === 'government_agency') return ['government_agency', 'agency', 'court'].includes(actual);
  if (expected === 'person') return ['person', 'individual_person', 'legislator', 'lobbyist', 'judge'].includes(actual);
  if (expected === 'nonprofit') return actual === 'nonprofit';
  return false;
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function inferIdentifierType(entity, value) {
  const sourceText = [
    entity.source_population_table,
    entity.source_system,
    ...jsonArray(entity.source_systems),
    asObject(entity.metadata).source,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const compactDigits = String(value ?? '').replace(/\D/g, '');

  if (sourceText.includes('pro_publica') || sourceText.includes('nonprofit') || sourceText.includes('irs')) {
    if (compactDigits.length === 9) return 'ein';
  }
  if (sourceText.includes('sec') || sourceText.includes('edgar')) return 'cik';
  if (sourceText.includes('usaspending') || sourceText.includes('sam_gov')) {
    const compact = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (compact.length === 12) return 'uei';
    if (compactDigits.length === 9) return 'duns';
  }
  return 'generic';
}

function addToSetMap(map, key, entityId) {
  if (!key || !entityId) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(String(entityId));
}

function addNameIndex(map, normalizedName, entityId, method) {
  if (!normalizedName || !entityId) return;
  if (!map.has(normalizedName)) map.set(normalizedName, new Map());
  const methodsByEntity = map.get(normalizedName);
  if (!methodsByEntity.has(String(entityId))) methodsByEntity.set(String(entityId), new Set());
  methodsByEntity.get(String(entityId)).add(method);
}

function resolverRelevantEntityRow(entity) {
  const metadata = asObject(entity.metadata);
  return {
    entity_id: firstNonEmpty(entity.entity_id, entity.entityId),
    entity_type: firstNonEmpty(entity.entity_type, entity.entityType),
    normalized_primary_name: normalizeEntityName(entity.primary_name ?? entity.primaryName),
    normalized_name_variants: sortedUnique(jsonArray(entity.name_variants ?? entity.nameVariants)
      .map((variant) => typeof variant === 'string'
        ? normalizeEntityName(variant)
        : normalizeEntityName(firstNonEmpty(variant?.name, variant?.value, variant?.alias)))
      .filter(Boolean)),
    source_systems: sortedUnique(jsonArray(entity.source_systems ?? entity.sourceSystems)),
    source_population_id: firstNonEmpty(entity.source_population_id, entity.sourcePopulationId),
    source_population_table: firstNonEmpty(entity.source_population_table, entity.sourcePopulationTable),
    source_external_id: firstNonEmpty(entity.source_external_id, entity.sourceExternalId),
    metadata_identifiers: {
      ein: normalizeIdentifier('ein', metadata.ein),
      cik: normalizeIdentifier('cik', metadata.cik),
      duns: normalizeIdentifier('duns', metadata.duns),
      uei: normalizeIdentifier('uei', metadata.uei),
      external_id: normalizeIdentifier('generic', firstNonEmpty(metadata.external_id, metadata.externalId)),
    },
  };
}

function usableAlias(alias, activeEntityIds) {
  const entityId = firstNonEmpty(alias.entity_id, alias.entityId);
  const aliasText = firstNonEmpty(alias.alias_text, alias.aliasText);
  const aliasType = String(alias.alias_type ?? alias.aliasType ?? '').toLowerCase();
  const confidence = Number(alias.confidence_score ?? alias.confidenceScore);
  if (!entityId || !aliasText || !activeEntityIds.has(entityId)) return false;
  if (aliasType === 'fuzzy_match') return false;
  if (!Number.isFinite(confidence) || confidence !== 1) return false;
  return true;
}

export function buildEntityIndex(entities = [], aliases = []) {
  const entityById = new Map();
  const identifiers = new Map();
  const names = new Map();
  const aliasNames = new Map();
  const activeEntities = [];

  for (const rawEntity of entities) {
    const entity = { ...rawEntity };
    const entityId = firstNonEmpty(entity.entity_id, entity.entityId);
    if (!entityId) continue;
    if (entity.is_active === false || entity.isActive === false) continue;

    activeEntities.push(entity);
    entityById.set(entityId, entity);
    addNameIndex(names, normalizeEntityName(entity.primary_name ?? entity.primaryName), entityId, 'primary_name');

    for (const variant of jsonArray(entity.name_variants ?? entity.nameVariants)) {
      const text = typeof variant === 'string' ? variant : firstNonEmpty(variant?.name, variant?.value, variant?.alias);
      addNameIndex(names, normalizeEntityName(text), entityId, 'name_variant');
    }

    const metadata = asObject(entity.metadata);
    const typedMetadataIdentifiers = [
      ['ein', metadata.ein],
      ['cik', metadata.cik],
      ['duns', metadata.duns],
      ['uei', metadata.uei],
      ['generic', metadata.external_id],
      ['generic', metadata.externalId],
    ];
    for (const [type, value] of typedMetadataIdentifiers) {
      const normalized = normalizeIdentifier(type, value);
      if (normalized) addToSetMap(identifiers, `${type}:${normalized}`, entityId);
    }

    for (const value of [
      entity.source_external_id,
      entity.sourceExternalId,
      entity.source_population_id,
      entity.sourcePopulationId,
    ]) {
      if (!firstNonEmpty(value)) continue;
      const inferredType = inferIdentifierType(entity, value);
      const normalizedSpecific = normalizeIdentifier(inferredType, value);
      const normalizedGeneric = normalizeIdentifier('generic', value);
      if (normalizedSpecific) addToSetMap(identifiers, `${inferredType}:${normalizedSpecific}`, entityId);
      if (normalizedGeneric) addToSetMap(identifiers, `generic:${normalizedGeneric}`, entityId);
    }
  }

  const activeEntityIds = new Set(entityById.keys());
  const acceptedAliases = [];
  let excludedAliasCount = 0;
  for (const rawAlias of aliases) {
    if (!usableAlias(rawAlias, activeEntityIds)) {
      excludedAliasCount += 1;
      continue;
    }
    const entityId = firstNonEmpty(rawAlias.entity_id, rawAlias.entityId);
    const alias = firstNonEmpty(rawAlias.alias_text, rawAlias.aliasText);
    acceptedAliases.push(rawAlias);
    addNameIndex(aliasNames, normalizeEntityName(alias), entityId, `alias:${rawAlias.alias_type ?? rawAlias.aliasType ?? 'unknown'}`);
  }

  const entitySnapshot = activeEntities
    .map(resolverRelevantEntityRow)
    .sort((a, b) => String(a.entity_id).localeCompare(String(b.entity_id)));
  const aliasSnapshot = acceptedAliases
    .map((alias) => ({
      entity_id: firstNonEmpty(alias.entity_id, alias.entityId),
      normalized_alias: normalizeEntityName(alias.alias_text ?? alias.aliasText),
      alias_type: firstNonEmpty(alias.alias_type, alias.aliasType),
      source_jurisdiction: firstNonEmpty(alias.source_jurisdiction, alias.sourceJurisdiction),
      source_system: firstNonEmpty(alias.source_system, alias.sourceSystem),
      confidence_score: 1,
    }))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));

  const entityIndexHash = sha256Text(stableStringify({ entities: entitySnapshot, aliases: aliasSnapshot }));

  return {
    entityById,
    identifiers,
    names,
    aliasNames,
    entity_index_hash: entityIndexHash,
    entity_count: entityById.size,
    alias_count: acceptedAliases.length,
    excluded_alias_count: excludedAliasCount,
  };
}

function selectedField(entries) {
  for (const [field, value, exactSourceValue = value] of entries) {
    if (value === undefined || value === null) continue;
    const sourceValue = String(exactSourceValue);
    const normalized = String(value).trim();
    if (normalized.length > 0) {
      return { field, value: normalized, source_value: sourceValue };
    }
  }
  return { field: null, value: null, source_value: null };
}

function titleRecipient(title) {
  const text = firstNonEmpty(title);
  if (!text) return null;
  const match = text.match(/^(?:Contract|Award|Grant)\s*:\s*(.+?)(?:\s+[—–-]\s+\$|\s+[—–-]\s+|$)/i);
  return match?.[1]?.trim() || null;
}

function rule(ruleId) {
  const definition = RULE_BY_ID.get(ruleId);
  if (!definition) throw new Error(`Unknown event-entity extraction rule: ${ruleId}`);
  return definition;
}

function candidateIdentity(candidate) {
  const normalizedName = normalizeEntityName(candidate.entity_name);
  const normalizedIdentifier = normalizeIdentifier(candidate.identifier_type, candidate.identifier_value);
  return sha256Text([
    candidate.rule_id,
    candidate.rule_version,
    candidate.entity_role,
    candidate.source_field,
    normalizedName,
    candidate.source_identifier_field,
    candidate.identifier_type,
    normalizedIdentifier,
    candidate.expected_entity_type,
  ].map((value) => value ?? '').join(FIELD_SEPARATOR));
}

export function extractEntityCandidates(event) {
  const payload = asObject(event.payload);
  const raw = asObject(payload.raw);
  const streamId = String(event.stream_id ?? '').toLowerCase();
  const signalType = String(event.signal_type ?? '').toLowerCase();
  const candidates = [];

  const push = ({
    ruleId,
    entityRole,
    sourceField,
    sourceFieldValue = null,
    entityName,
    sourceIdentifierField = null,
    sourceIdentifierValue = null,
    identifierType = null,
    identifierValue = null,
    expectedEntityType = null,
  }) => {
    const definition = rule(ruleId);
    const name = firstNonEmpty(entityName);
    const idValue = firstNonEmpty(identifierValue);
    if (!name && !idValue) return;
    const candidate = {
      rule_id: definition.rule_id,
      rule_version: definition.rule_version,
      entity_role: entityRole,
      source_field: sourceField ?? '__none__',
      source_field_value: sourceFieldValue === undefined || sourceFieldValue === null
        ? (entityName === undefined || entityName === null ? null : String(entityName))
        : String(sourceFieldValue),
      entity_name: name,
      source_identifier_field: sourceIdentifierField,
      source_identifier_value: sourceIdentifierValue === undefined || sourceIdentifierValue === null
        ? (identifierValue === undefined || identifierValue === null ? null : String(identifierValue))
        : String(sourceIdentifierValue),
      identifier_type: identifierType,
      identifier_value: idValue,
      expected_entity_type: expectedEntityType,
    };
    candidate.candidate_key = candidateIdentity(candidate);
    candidates.push(candidate);
  };

  if (streamId === 'pro_publica') {
    if (signalType === 'nonprofit_registry_record') {
      const name = selectedField([
        ['payload.name', payload.name],
        ['payload.raw.name', raw.name],
        ['payload.raw.sub_name', raw.sub_name],
      ]);
      const identifier = selectedField([
        ['payload.ein', payload.ein],
        ['payload.external_id', payload.external_id],
        ['payload.raw.ein', raw.ein],
      ]);
      push({
        ruleId: 'pro_publica.nonprofit_registry_record.subject_nonprofit',
        entityRole: 'subject_nonprofit',
        sourceField: name.field,
        sourceFieldValue: name.source_value,
        entityName: name.value,
        sourceIdentifierField: identifier.field,
        sourceIdentifierValue: identifier.source_value,
        identifierType: 'ein',
        identifierValue: identifier.value,
        expectedEntityType: 'nonprofit',
      });
    } else if (signalType === 'nonprofit_990' || signalType === 'nonprofit_990_filing') {
      const name = selectedField([
        ['payload.organization_name', payload.organization_name],
        ['payload.name', payload.name],
        ['payload.raw.organization_name', raw.organization_name],
        ['payload.raw.name', raw.name],
      ]);
      const identifier = selectedField([
        ['payload.ein', payload.ein],
        ['payload.raw.ein', raw.ein],
      ]);
      push({
        ruleId: 'pro_publica.nonprofit_990.subject_nonprofit',
        entityRole: 'subject_nonprofit',
        sourceField: name.field,
        sourceFieldValue: name.source_value,
        entityName: name.value,
        sourceIdentifierField: identifier.field,
        sourceIdentifierValue: identifier.source_value,
        identifierType: 'ein',
        identifierValue: identifier.value,
        expectedEntityType: 'nonprofit',
      });
    }
  }

  if (streamId === 'cfpb_complaints') {
    const name = selectedField([
      ['payload.company', payload.company],
      ['payload.employer', payload.employer],
    ]);
    push({
      ruleId: 'cfpb_complaints.complained_against_entity',
      entityRole: 'complained_against_entity',
      sourceField: name.field,
      sourceFieldValue: name.source_value,
      entityName: name.value,
      expectedEntityType: 'organization',
    });
  }

  if (streamId === 'eeoc_filings') {
    const name = selectedField([['payload.employer', payload.employer]]);
    push({
      ruleId: 'eeoc_filings.respondent_employer',
      entityRole: 'respondent_employer',
      sourceField: name.field,
      sourceFieldValue: name.source_value,
      entityName: name.value,
      expectedEntityType: 'organization',
    });
  }

  if (streamId === 'sec_edgar') {
    const name = selectedField([['payload.company', payload.company]]);
    const identifier = selectedField([['payload.cik', payload.cik]]);
    push({
      ruleId: 'sec_edgar.issuer',
      entityRole: 'issuer',
      sourceField: name.field,
      sourceFieldValue: name.source_value,
      entityName: name.value,
      sourceIdentifierField: identifier.field,
      sourceIdentifierValue: identifier.source_value,
      identifierType: 'cik',
      identifierValue: identifier.value,
      expectedEntityType: 'organization',
    });
  }

  if (streamId === 'regulations_gov') {
    const name = selectedField([
      ['payload.agency', payload.agency],
      ['payload.agency_name', payload.agency_name],
    ]);
    push({
      ruleId: 'regulations_gov.issuing_agency',
      entityRole: 'issuing_agency',
      sourceField: name.field,
      sourceFieldValue: name.source_value,
      entityName: name.value,
      expectedEntityType: 'government_agency',
    });
  }

  if (streamId === 'usa_spending') {
    const recipient = selectedField([
      ['payload.recipient_name', payload.recipient_name],
      ['payload.recipient', payload.recipient],
      ['payload.award_recipient', payload.award_recipient],
      ['payload.recipient_legal_entity_name', payload.recipient_legal_entity_name],
      ['payload.title', titleRecipient(payload.title), payload.title],
    ]);
    const uei = selectedField([
      ['payload.recipient_uei', payload.recipient_uei],
      ['payload.uei', payload.uei],
    ]);
    const duns = selectedField([
      ['payload.recipient_duns', payload.recipient_duns],
      ['payload.duns', payload.duns],
    ]);
    const identifier = uei.value ? { ...uei, type: 'uei' } : { ...duns, type: duns.value ? 'duns' : null };
    push({
      ruleId: 'usa_spending.award_recipient',
      entityRole: 'award_recipient',
      sourceField: recipient.field,
      sourceFieldValue: recipient.source_value,
      entityName: recipient.value,
      sourceIdentifierField: identifier.field,
      sourceIdentifierValue: identifier.source_value,
      identifierType: identifier.type,
      identifierValue: identifier.value,
      expectedEntityType: 'organization',
    });

    const agency = selectedField([
      ['payload.agency', payload.agency],
      ['payload.awarding_agency_name', payload.awarding_agency_name],
    ]);
    push({
      ruleId: 'usa_spending.awarding_agency',
      entityRole: 'awarding_agency',
      sourceField: agency.field,
      sourceFieldValue: agency.source_value,
      entityName: agency.value,
      expectedEntityType: 'government_agency',
    });
  }

  if (streamId === 'grants_gov') {
    const agency = selectedField([
      ['payload.agency', payload.agency],
      ['payload.agency_name', payload.agency_name],
    ]);
    push({
      ruleId: 'grants_gov.granting_agency',
      entityRole: 'granting_agency',
      sourceField: agency.field,
      sourceFieldValue: agency.source_value,
      entityName: agency.value,
      expectedEntityType: 'government_agency',
    });
  }

  if (streamId === 'open_states') {
    const directSponsor = selectedField([
      ['payload.sponsor', payload.sponsor],
      ['payload.sponsor_name', payload.sponsor_name],
    ]);
    push({
      ruleId: 'open_states.legislative_sponsor',
      entityRole: 'legislative_sponsor',
      sourceField: directSponsor.field,
      sourceFieldValue: directSponsor.source_value,
      entityName: directSponsor.value,
      expectedEntityType: 'person',
    });

    if (Array.isArray(payload.sponsors)) {
      payload.sponsors.forEach((sponsor, index) => {
        const sponsorField = typeof sponsor === 'string'
          ? `payload.sponsors[${index}]`
          : sponsor?.name !== undefined
            ? `payload.sponsors[${index}].name`
            : sponsor?.full_name !== undefined
              ? `payload.sponsors[${index}].full_name`
              : `payload.sponsors[${index}].sponsor_name`;
        const sponsorSourceValue = typeof sponsor === 'string'
          ? sponsor
          : sponsor?.name !== undefined
            ? sponsor.name
            : sponsor?.full_name !== undefined
              ? sponsor.full_name
              : sponsor?.sponsor_name;
        const sponsorName = firstNonEmpty(sponsorSourceValue);
        push({
          ruleId: 'open_states.legislative_sponsor',
          entityRole: 'legislative_sponsor',
          sourceField: sponsorField,
          sourceFieldValue: sponsorSourceValue,
          entityName: sponsorName,
          expectedEntityType: 'person',
        });
      });
    }
  }

  if (candidates.length === 0) {
    const canonicalEntityId = selectedField([
      ['payload.canonical_entity_id', payload.canonical_entity_id],
    ]);
    const genericName = selectedField([
      ['payload.entity_name', payload.entity_name],
      ['payload.entity', payload.entity],
    ]);

    if (canonicalEntityId.value) {
      push({
        ruleId: 'generic.canonical_entity_id',
        entityRole: 'subject_entity',
        sourceField: genericName.field,
        sourceFieldValue: genericName.source_value,
        entityName: genericName.value,
        sourceIdentifierField: canonicalEntityId.field,
        sourceIdentifierValue: canonicalEntityId.source_value,
        identifierType: 'canonical_entity_id',
        identifierValue: canonicalEntityId.value,
      });
    } else if (genericName.value) {
      push({
        ruleId: 'generic.declared_subject_field',
        entityRole: 'subject_entity',
        sourceField: genericName.field,
        sourceFieldValue: genericName.source_value,
        entityName: genericName.value,
      });
    }
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.candidate_key)) return false;
    seen.add(candidate.candidate_key);
    return true;
  });
}

function methodsFor(nameMap, normalizedName) {
  const byEntity = nameMap.get(normalizedName) ?? new Map();
  const ids = [...byEntity.keys()].sort();
  return { ids, byEntity };
}

function identifierMatches(index, identifierType, normalizedIdentifier) {
  if (!normalizedIdentifier) return [];
  const type = String(identifierType ?? 'generic').toLowerCase();
  if (type === 'canonical_entity_id') {
    return index.entityById.has(normalizedIdentifier) ? [normalizedIdentifier] : [];
  }
  return sortedUnique(index.identifiers.get(`${type}:${normalizedIdentifier}`) ?? []);
}

function actualEntityTypes(index, entityIds) {
  return Object.fromEntries(entityIds.map((entityId) => [
    entityId,
    firstNonEmpty(index.entityById.get(entityId)?.entity_type, index.entityById.get(entityId)?.entityType),
  ]));
}

export function buildResolutionHash(row) {
  const candidates = sortedUnique(row.candidate_entity_ids);
  return sha256Text([
    row.event_input_hash,
    row.entity_index_hash,
    row.rule_manifest_hash,
    row.rule_id,
    row.rule_version,
    row.candidate_key,
    row.entity_role,
    row.source_field,
    row.normalized_entity_value,
    row.source_identifier_field,
    row.source_identifier_type,
    row.normalized_identifier_value,
    row.expected_entity_type,
    row.resolution_status,
    row.entity_id,
    row.match_method,
    candidates.join(ARRAY_SEPARATOR),
    row.resolver_id,
    row.resolver_version,
  ].map((value) => value ?? '').join(FIELD_SEPARATOR));
}

export function resolveCandidate(event, candidate, index, {
  resolverId = EVENT_ENTITY_RESOLVER_ID,
  resolverVersion = EVENT_ENTITY_RESOLVER_VERSION,
  ruleManifestHash = EVENT_ENTITY_RULE_MANIFEST_HASH,
} = {}) {
  if (!index?.entity_index_hash) throw new Error('entity index is missing entity_index_hash');

  const normalizedName = normalizeEntityName(candidate.entity_name);
  const normalizedIdentifier = normalizeIdentifier(candidate.identifier_type, candidate.identifier_value);
  const idMatches = identifierMatches(index, candidate.identifier_type, normalizedIdentifier);
  const primaryMatches = normalizedName ? methodsFor(index.names, normalizedName) : { ids: [], byEntity: new Map() };
  const aliasMatches = normalizedName ? methodsFor(index.aliasNames, normalizedName) : { ids: [], byEntity: new Map() };
  const nameMatches = sortedUnique([...primaryMatches.ids, ...aliasMatches.ids]);
  const allMatches = sortedUnique([...idMatches, ...nameMatches]);

  let resolutionStatus = 'unresolved';
  let matchMethod = normalizedIdentifier || normalizedName ? 'no_exact_match' : 'no_usable_identity_value';
  let entityId = null;
  let prospectiveEntityId = null;

  if (idMatches.length === 1) {
    const identifierEntityId = idMatches[0];
    const conflictingNameIds = nameMatches.filter((id) => id !== identifierEntityId);
    if (conflictingNameIds.length === 0) {
      prospectiveEntityId = identifierEntityId;
      matchMethod = candidate.identifier_type === 'canonical_entity_id'
        ? 'exact_canonical_entity_id'
        : 'exact_external_identifier';
    } else {
      resolutionStatus = 'ambiguous';
      matchMethod = 'identifier_name_conflict';
    }
  } else if (idMatches.length > 1) {
    resolutionStatus = 'ambiguous';
    matchMethod = 'duplicate_external_identifier';
  } else if (nameMatches.length === 1) {
    prospectiveEntityId = nameMatches[0];
    const primaryMethods = [...(primaryMatches.byEntity.get(prospectiveEntityId) ?? [])];
    if (primaryMethods.includes('primary_name')) matchMethod = 'exact_primary_name';
    else if (primaryMethods.includes('name_variant')) matchMethod = 'exact_name_variant';
    else matchMethod = 'exact_alias';
  } else if (nameMatches.length > 1) {
    resolutionStatus = 'ambiguous';
    matchMethod = 'duplicate_exact_name';
  }

  if (prospectiveEntityId) {
    const actualType = firstNonEmpty(
      index.entityById.get(prospectiveEntityId)?.entity_type,
      index.entityById.get(prospectiveEntityId)?.entityType,
    );
    if (isEntityTypeCompatible(candidate.expected_entity_type, actualType)) {
      resolutionStatus = 'resolved';
      entityId = prospectiveEntityId;
    } else {
      resolutionStatus = 'unresolved';
      matchMethod = 'exact_match_entity_type_mismatch';
    }
  }

  const row = {
    stream_id: String(event.stream_id),
    event_offset: String(event.offset),
    event_timestamp: event.timestamp,
    signal_type: String(event.signal_type),
    source_id: String(event.source_id),
    jurisdiction_id: String(event.jurisdiction_id),
    module_hint: String(event.module_hint),
    rule_id: candidate.rule_id,
    rule_version: candidate.rule_version,
    candidate_key: candidate.candidate_key,
    entity_role: candidate.entity_role,
    source_field: candidate.source_field,
    source_field_value: candidate.source_field_value,
    source_entity_value: candidate.entity_name,
    normalized_entity_value: normalizedName,
    source_identifier_field: candidate.source_identifier_field,
    source_identifier_type: candidate.identifier_type,
    source_identifier_value: candidate.source_identifier_value,
    normalized_identifier_value: normalizedIdentifier,
    expected_entity_type: candidate.expected_entity_type,
    entity_id: entityId,
    resolution_status: resolutionStatus,
    match_method: matchMethod,
    candidate_entity_ids: allMatches,
    match_evidence: {
      exact_identifier_matches: idMatches,
      exact_name_matches: primaryMatches.ids,
      exact_alias_matches: aliasMatches.ids,
      candidate_entity_types: actualEntityTypes(index, allMatches),
      expected_entity_type: candidate.expected_entity_type,
      identifier_was_supplied: candidate.identifier_value !== null && candidate.identifier_value !== undefined,
      identifier_was_valid: candidate.identifier_value === null || candidate.identifier_value === undefined
        ? null
        : normalizedIdentifier !== null,
      alias_policy: 'exact_non_fuzzy_confidence_1_only',
      no_fuzzy_matching: true,
      no_silent_entity_creation: true,
    },
    event_input_hash: event.event_input_hash,
    entity_index_hash: index.entity_index_hash,
    rule_manifest_hash: ruleManifestHash,
    resolver_id: resolverId,
    resolver_version: resolverVersion,
  };
  row.resolution_hash = buildResolutionHash(row);
  return row;
}

export function resolveEvent(event, index, options = {}) {
  if (!event?.event_input_hash) {
    throw new Error(`Event ${event?.stream_id ?? 'unknown'}:${event?.offset ?? 'unknown'} is missing event_input_hash.`);
  }
  if (!index?.entity_index_hash) throw new Error('entity index is missing entity_index_hash');

  const candidates = extractEntityCandidates(event);
  if (candidates.length === 0) {
    const candidate = {
      rule_id: 'system.no_declared_entity_rule',
      rule_version: EVENT_ENTITY_RULE_VERSION,
      entity_role: 'none',
      source_field: '__none__',
      source_field_value: null,
      entity_name: null,
      source_identifier_field: null,
      identifier_type: null,
      identifier_value: null,
      expected_entity_type: null,
    };
    candidate.candidate_key = candidateIdentity(candidate);

    const row = {
      stream_id: String(event.stream_id),
      event_offset: String(event.offset),
      event_timestamp: event.timestamp,
      signal_type: String(event.signal_type),
      source_id: String(event.source_id),
      jurisdiction_id: String(event.jurisdiction_id),
      module_hint: String(event.module_hint),
      rule_id: candidate.rule_id,
      rule_version: candidate.rule_version,
      candidate_key: candidate.candidate_key,
      entity_role: candidate.entity_role,
      source_field: candidate.source_field,
      source_field_value: null,
      source_entity_value: null,
      normalized_entity_value: null,
      source_identifier_field: null,
      source_identifier_type: null,
      source_identifier_value: null,
      normalized_identifier_value: null,
      expected_entity_type: null,
      entity_id: null,
      resolution_status: 'ignored',
      match_method: 'no_declared_entity_rule',
      candidate_entity_ids: [],
      match_evidence: {
        no_declared_entity_rule: true,
        stream_id: event.stream_id,
        signal_type: event.signal_type,
        no_fuzzy_matching: true,
        no_silent_entity_creation: true,
      },
      event_input_hash: event.event_input_hash,
      entity_index_hash: index.entity_index_hash,
      rule_manifest_hash: options.ruleManifestHash ?? EVENT_ENTITY_RULE_MANIFEST_HASH,
      resolver_id: options.resolverId ?? EVENT_ENTITY_RESOLVER_ID,
      resolver_version: options.resolverVersion ?? EVENT_ENTITY_RESOLVER_VERSION,
    };
    row.resolution_hash = buildResolutionHash(row);
    return [row];
  }

  return candidates.map((candidate) => resolveCandidate(event, candidate, index, options));
}

export function resolveEventBatch(events, index, options = {}) {
  return events.flatMap((event) => resolveEvent(event, index, options));
}

function assertSupabaseResult(result, label) {
  if (result?.error) {
    const details = result.error.details || result.error.hint || '';
    throw new Error(`${label} failed: ${result.error.message}${details ? ` (${details})` : ''}`);
  }
  return result?.data;
}

async function loadAllViewRows(supabase, viewName, orderColumn, {
  pageSize = INDEX_PAGE_SIZE,
  maxRows = MAX_INDEX_ROWS,
} = {}) {
  const rows = [];
  let from = 0;

  while (rows.length < maxRows) {
    const result = await supabase
      .from(viewName)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    const page = assertSupabaseResult(result, `${viewName} load`) ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
    from += pageSize;
  }

  throw new Error(`${viewName} exceeds ${maxRows} rows; refusing silent index truncation.`);
}

export async function loadResolutionIndex(supabase) {
  const entities = await loadAllViewRows(
    supabase,
    'v_atlas_entity_resolution_registry_v1',
    'entity_id',
  );
  const aliases = await loadAllViewRows(
    supabase,
    'v_atlas_entity_resolution_aliases_v1',
    'alias_id',
  );
  return buildEntityIndex(entities, aliases);
}

function normalizeBigintString(value, label) {
  const normalized = String(value ?? '-1').trim();
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} must be an integer string`);
  return normalized;
}

export async function drainEventEntityResolution({
  supabase,
  streamId = null,
  batchSize = 500,
  maxBatches = 200,
  afterStreamId = null,
  afterOffset = '-1',
  resolverId = EVENT_ENTITY_RESOLVER_ID,
  resolverVersion = EVENT_ENTITY_RESOLVER_VERSION,
  ruleManifestHash = EVENT_ENTITY_RULE_MANIFEST_HASH,
} = {}) {
  if (!supabase) throw new Error('supabase client is required');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error('batchSize must be an integer between 1 and 5000');
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100_000) {
    throw new Error('maxBatches must be an integer between 1 and 100000');
  }
  if (streamId && afterStreamId && streamId !== afterStreamId) {
    throw new Error('afterStreamId must equal streamId when a single stream is selected');
  }

  const initialOffset = normalizeBigintString(afterOffset, 'afterOffset');
  const initialStreamCursor = afterStreamId ?? (streamId ? streamId : null);
  const runId = randomUUID();
  const index = await loadResolutionIndex(supabase);
  const totals = {
    processed_event_count: 0,
    resolution_row_count: 0,
    resolved_count: 0,
    ambiguous_count: 0,
    unresolved_count: 0,
    ignored_count: 0,
    inserted_count: 0,
    idempotent_count: 0,
  };

  const inputManifest = {
    resolver_id: resolverId,
    resolver_version: resolverVersion,
    rule_manifest_hash: ruleManifestHash,
    entity_index_hash: index.entity_index_hash,
    stream_id: streamId,
    after_stream_id: initialStreamCursor,
    after_offset: initialOffset,
    batch_size: batchSize,
    max_batches: maxBatches,
    entity_registry_count: index.entity_count,
    accepted_alias_count: index.alias_count,
    rule_count: EVENT_ENTITY_RULE_MANIFEST.length,
    rule_ids: EVENT_ENTITY_RULE_MANIFEST.map((entry) => entry.rule_id),
    exact_match_precedence: [
      'canonical_entity_id',
      'external_identifier',
      'canonical_primary_name',
      'canonical_name_variant',
      'retained_exact_alias',
    ],
    no_fuzzy_matching: true,
    no_silent_entity_creation: true,
  };

  assertSupabaseResult(await supabase.rpc('start_atlas_event_entity_resolution_run_v1', {
    p_run_id: runId,
    p_resolver_id: resolverId,
    p_resolver_version: resolverVersion,
    p_rule_manifest_hash: ruleManifestHash,
    p_entity_index_hash: index.entity_index_hash,
    p_stream_id: streamId,
    p_batch_size: batchSize,
    p_input_manifest: inputManifest,
  }), 'resolution run start');

  let cursorStreamId = initialStreamCursor;
  let cursorOffset = initialOffset;
  let batchCount = 0;
  let exhausted = false;

  try {
    while (batchCount < maxBatches) {
      const events = assertSupabaseResult(await supabase.rpc('fetch_atlas_signal_events_for_entity_resolution_v1', {
        p_batch_size: batchSize,
        p_stream_id: streamId,
        p_after_stream_id: cursorStreamId,
        p_after_offset: cursorOffset,
      }), 'event batch fetch') ?? [];

      if (events.length === 0) {
        exhausted = true;
        break;
      }

      const rows = resolveEventBatch(events, index, {
        resolverId,
        resolverVersion,
        ruleManifestHash,
      });
      const persistResult = assertSupabaseResult(await supabase.rpc('persist_atlas_event_entity_resolution_batch_v1', {
        p_run_id: runId,
        p_resolver_id: resolverId,
        p_resolver_version: resolverVersion,
        p_rule_manifest_hash: ruleManifestHash,
        p_entity_index_hash: index.entity_index_hash,
        p_rows: rows,
      }), 'event-entity resolution persistence');

      totals.processed_event_count += events.length;
      totals.resolution_row_count += rows.length;
      for (const row of rows) totals[`${row.resolution_status}_count`] += 1;
      totals.inserted_count += Number(persistResult?.inserted_count ?? 0);
      totals.idempotent_count += Number(persistResult?.idempotent_count ?? 0);

      const lastEvent = events.at(-1);
      cursorStreamId = String(lastEvent.stream_id);
      cursorOffset = normalizeBigintString(lastEvent.offset, 'event offset');
      batchCount += 1;

      if (events.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    const runStatus = exhausted ? 'completed' : 'partial';
    assertSupabaseResult(await supabase.rpc('complete_atlas_event_entity_resolution_run_v1', {
      p_run_id: runId,
      p_status: runStatus,
      p_counts: totals,
      p_last_stream_id: cursorStreamId,
      p_last_offset: cursorOffset,
      p_error_message: null,
    }), 'resolution run completion');

    return {
      run_id: runId,
      status: runStatus,
      has_more: !exhausted,
      resolver_id: resolverId,
      resolver_version: resolverVersion,
      rule_manifest_hash: ruleManifestHash,
      entity_index_hash: index.entity_index_hash,
      batches: batchCount,
      last_stream_id: cursorStreamId,
      last_offset: cursorOffset,
      ...totals,
    };
  } catch (error) {
    try {
      await supabase.rpc('complete_atlas_event_entity_resolution_run_v1', {
        p_run_id: runId,
        p_status: 'failed',
        p_counts: {},
        p_last_stream_id: cursorStreamId,
        p_last_offset: cursorOffset,
        p_error_message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Preserve the original execution error. The run remains inspectable as running
      // if the failure-state write could not be persisted.
    }
    throw error;
  }
}

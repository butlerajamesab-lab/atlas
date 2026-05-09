import { postSignalsToAtlas, sourceUrlFrom, toIsoTimestamp } from './ingestClient.js';

const AGENCY_CONFIG = {
  cfpb: {
    sourceId: 'cfpb',
    streamId: 'cfpb_complaints',
    moduleHint: 'consumer_finance',
    signalType: 'cfpb_complaint',
  },
  eeoc: {
    sourceId: 'eeoc',
    streamId: 'eeoc_filings',
    moduleHint: 'civil_rights',
    signalType: 'eeoc_filing',
  },
  dol_whd: {
    sourceId: 'dol_whd',
    streamId: 'dol_whd_violations',
    moduleHint: 'labor_enforcement',
    signalType: 'dol_whd_violation',
  },
  osha: {
    sourceId: 'osha',
    streamId: 'osha_incidents',
    moduleHint: 'workplace_safety',
    signalType: 'osha_incident',
  },
};

function regionFromRecord(record) {
  return (
    record.jurisdiction ||
    record.region ||
    record.county ||
    record.state ||
    record.state_code ||
    record.location?.state ||
    record.establishment_state ||
    record.company_state ||
    'us_federal'
  );
}

function sourceUrlFor(record, agency) {
  return sourceUrlFrom(
    record.source_url,
    record.sourceUrl,
    record.url,
    record.original_url,
    record.pdf_url,
    record.document_url,
    agency === 'cfpb' && record.complaint_id ? `https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail/${record.complaint_id}` : null,
    agency === 'osha' && record.activity_nr ? `https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${record.activity_nr}` : null,
  );
}

function timestampFor(record) {
  return toIsoTimestamp(
    record.timestamp,
    record.date_received,
    record.received_date,
    record.filing_date,
    record.violation_date,
    record.inspection_date,
    record.incident_date,
    record.open_date,
    record.created_at,
  );
}

export function normalizeOfficialAgencyRecord(record, agency) {
  const config = AGENCY_CONFIG[agency];
  if (!config) throw new Error(`Unsupported official agency stream: ${agency}`);

  const region = regionFromRecord(record);
  const sourceUrl = sourceUrlFor(record, agency);
  const complaintType = record.complaint_type || record.issue || record.basis || record.violation_type || record.incident_type || config.signalType;

  return {
    signal_type: complaintType || config.signalType,
    timestamp: timestampFor(record),
    spacetime: {
      region,
      jurisdiction: region,
      county: record.county || record.establishment_county || record.location?.county || null,
      state: record.state || record.establishment_state || record.location?.state || null,
    },
    provenance: {
      channel: agency,
      source_system: agency,
      confidence: 1.0,
      source_url: sourceUrl,
    },
    payload: {
      external_id: record.complaint_id || record.charge_id || record.case_id || record.activity_nr || record.id || null,
      complaint_type: complaintType || config.signalType,
      employer: record.employer || record.company || record.establishment_name || record.respondent || null,
      agency,
      source_url: sourceUrl,
      raw: record,
    },
  };
}

export async function ingestOfficialAgencyRecords({ agency, records, apiBaseUrl } = {}) {
  const config = AGENCY_CONFIG[agency];
  if (!config) throw new Error(`Unsupported official agency stream: ${agency}`);
  if (!records?.length) return { accepted: 0, stored: 0, stream_id: config.streamId };

  return postSignalsToAtlas({
    sourceId: config.sourceId,
    jurisdictionId: 'us_federal',
    moduleHint: config.moduleHint,
    signals: records.map((record) => normalizeOfficialAgencyRecord(record, agency)),
    apiBaseUrl,
  });
}

export async function ingestCfpbComplaints(records, options = {}) {
  return ingestOfficialAgencyRecords({ agency: 'cfpb', records, ...options });
}

export async function ingestEeocFilings(records, options = {}) {
  return ingestOfficialAgencyRecords({ agency: 'eeoc', records, ...options });
}

export async function ingestDolWhdViolations(records, options = {}) {
  return ingestOfficialAgencyRecords({ agency: 'dol_whd', records, ...options });
}

export async function ingestOshaIncidents(records, options = {}) {
  return ingestOfficialAgencyRecords({ agency: 'osha', records, ...options });
}

export async function ingestAllOfficialAgencyRecords({ cfpbComplaints = [], eeocFilings = [], dolWhdViolations = [], oshaIncidents = [], apiBaseUrl } = {}) {
  return {
    cfpb: await ingestCfpbComplaints(cfpbComplaints, { apiBaseUrl }),
    eeoc: await ingestEeocFilings(eeocFilings, { apiBaseUrl }),
    dol_whd: await ingestDolWhdViolations(dolWhdViolations, { apiBaseUrl }),
    osha: await ingestOshaIncidents(oshaIncidents, { apiBaseUrl }),
  };
}

export { AGENCY_CONFIG as officialAgencyStreamConfig };

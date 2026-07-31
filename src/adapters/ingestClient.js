import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export const ATLAS_API_BASE_URL = process.env.ATLAS_API_BASE_URL || `http://localhost:${process.env.PORT || 8787}`;

export function sourceUrlFrom(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0) || null;
}

export function toIsoTimestamp(...values) {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '');
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

export function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export async function postSignalsToAtlas({ sourceId, jurisdictionId, moduleHint, signals, apiBaseUrl = ATLAS_API_BASE_URL }) {
  const ingestToken = process.env.ATLAS_INGEST_TOKEN;
  if (!ingestToken) {
    throw new Error('ATLAS_INGEST_TOKEN is required for adapter ingestion');
  }

  const body = {
    source_id: sourceId,
    jurisdiction_id: jurisdictionId,
    module_hint: moduleHint,
    signals,
  };

  const response = await axios.post(`${apiBaseUrl}/v1/ingest/signals`, body, {
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${ingestToken}`,
      'Content-Type': 'application/json',
    },
  });
  return response.data;
}
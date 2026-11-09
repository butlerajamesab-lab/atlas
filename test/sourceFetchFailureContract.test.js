// Source-fetch failure contract (rulebook audit 2026-11-09,
// Finding 1): a failed upstream fetch must surface as a failure,
// never as an empty result.
//
// Five fetch paths used to warn-and-return-[] on upstream failure.
// Downstream that reads exactly like a healthy empty draw, and it
// hid the Senate LDA outage for two days. The fetch functions now
// throw SourceFetchError, which propagates through the ingest
// wrappers to the scheduler, which receipts the run as failed.
//
// These tests stub axios at the module object both the test and
// the adapters import, so the behavior exercised is the adapters'
// own: failure rejects with the typed error; a successful-but-
// empty answer still resolves to [] (empty is a data fact;
// failure is an event — the contract keeps them distinct).

import assert from 'node:assert/strict';
import test from 'node:test';

import axios from 'axios';

import { SourceFetchError } from '../src/adapters/sourceFetchError.js';
import { fetchLobbyingFilings } from '../src/adapters/openSecretsAdapter.js';
import { fetchFaraRegistrants } from '../src/adapters/faraForeignAgentsAdapter.js';
import { fetch501c4Orgs } from '../src/adapters/irsExemptOrgAdapter.js';
import { fetchRecentFilings } from '../src/adapters/secEdgarAdapter.js';

const originalGet = axios.get;

function stubAxiosGet(impl) {
  axios.get = impl;
}

function restoreAxiosGet() {
  axios.get = originalGet;
}

const failingGet = async () => {
  const error = new Error('Request failed with status code 503');
  error.response = { status: 503 };
  throw error;
};

test('Senate LDA fetch failure throws SourceFetchError, not an empty array', async () => {
  stubAxiosGet(failingGet);
  try {
    await assert.rejects(fetchLobbyingFilings({}), (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.source, 'senate_lda');
      assert.match(error.message, /source_fetch_failed: senate_lda/);
      return true;
    });
  } finally {
    restoreAxiosGet();
  }
});

test('FARA fetch failure throws SourceFetchError', async () => {
  stubAxiosGet(failingGet);
  try {
    await assert.rejects(fetchFaraRegistrants({}), (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.source, 'fara_registrants');
      return true;
    });
  } finally {
    restoreAxiosGet();
  }
});

test('501c4 search failure throws SourceFetchError', async () => {
  stubAxiosGet(failingGet);
  try {
    await assert.rejects(fetch501c4Orgs('WA', 5), (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.source, 'propublica_nonprofit_501c4');
      return true;
    });
  } finally {
    restoreAxiosGet();
  }
});

test('SEC filings: when search AND the RSS fallback both fail, the failure throws', async () => {
  stubAxiosGet(failingGet);
  try {
    await assert.rejects(fetchRecentFilings({ formType: '4', limit: 5 }), (error) => {
      assert.ok(error instanceof SourceFetchError);
      assert.equal(error.source, 'sec_edgar_rss');
      return true;
    });
  } finally {
    restoreAxiosGet();
  }
});

test('a successful-but-empty answer still resolves to an empty array', async () => {
  stubAxiosGet(async () => ({ data: { results: [] } }));
  try {
    const filings = await fetchLobbyingFilings({});
    assert.deepEqual(filings, []);
  } finally {
    restoreAxiosGet();
  }
});

test('SourceFetchError carries the source and preserves the cause', () => {
  const cause = new Error('socket hang up');
  const error = new SourceFetchError('senate_lda', cause);
  assert.equal(error.name, 'SourceFetchError');
  assert.equal(error.source, 'senate_lda');
  assert.equal(error.cause, cause);
  assert.match(error.message, /source_fetch_failed: senate_lda: socket hang up/);
});

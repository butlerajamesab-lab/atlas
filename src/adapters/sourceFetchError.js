// SourceFetchError — a failed upstream fetch is a FAILURE, not an
// empty result (rulebook audit 2026-11-09, Finding 1).
//
// Five adapter fetch paths used to warn-and-return-[] when their
// source failed. Downstream, that empty array reads exactly like a
// healthy draw over unchanging data: the scheduler receipts the run
// as completed/unexpectedly_zero and the outage is invisible — the
// Senate LDA outage hid for two days behind this pattern. Throwing
// this error instead lets the failure propagate to the scheduler,
// which receipts the run as outcomeStatus 'failed' with the error
// attached: a failed fetch is now distinguishable from an empty
// result in the durable record, which is the entire point.
//
// A source answering successfully with zero records still returns
// [] — empty is a data fact; failure is an event. Never conflate
// them.

export class SourceFetchError extends Error {
  constructor(source, cause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause ?? 'unknown');
    super(`source_fetch_failed: ${source}: ${causeMessage}`);
    this.name = 'SourceFetchError';
    this.source = source;
    this.cause = cause;
  }
}

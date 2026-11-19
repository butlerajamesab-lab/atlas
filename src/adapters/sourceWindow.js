/**
 * No source page is "complete" merely because its HTTP request worked.
 * This is an explicit transport/coverage hold, not a certified source fact.
 */
export function heldSourceWindow(source, recordsSeen, reason = 'source_window_incomplete') {
  return {
    accepted: false,
    status: 'held',
    ingested_count: 0,
    records_seen: recordsSeen,
    held_count: recordsSeen,
    source_hold: { source, reason, pages_fetched: 1, records_seen: recordsSeen, records_persisted: 0 },
  };
}

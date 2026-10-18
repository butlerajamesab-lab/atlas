// Preserve explicit empty user selections: only an omitted or non-array
// selection uses the full catalog. No database access is performed here.
export function selectPublicStreamCatalogRows(catalog, stream_ids) {
  if (!Array.isArray(stream_ids)) return catalog;
  const selectedIds = new Set(stream_ids);
  return catalog.filter((stream) => selectedIds.has(stream.stream_id));
}

# Atlas Signal Ontology Contract

**Status:** Canonical
**Effective:** 2026-08-09

## Purpose

Atlas normalizes public-system observations, derives civic signals under declared rules, computes structural relationships and convergence, and emits deterministic receipts. It does not convert every source pull into a signal.

The controlling separation is:

```text
source record
  != normalized observation
  != derived civic signal
  != convergence result
  != governed finding
  != projection
  != human decision
```

Observation and interpretation remain separate:

```text
O != I
```

Missing evidence remains unresolved:

```text
unknown != false
```

## Deterministic contract

For complete input state `X`, declared rules `R`, and engine version `v`:

```text
Y = F_v(X, R)
```

Identical inputs, rules, and engine versions must produce identical outputs. Every derived signal or convergence result must preserve source identity, rule identity, engine version, provenance, failure state, and an inspectable output hash.

## Civic signal

A normalized civic signal is:

```text
s_i = (t_i, g_i, c_i, x_i, p_i)
```

where:

- `t_i` is time;
- `g_i` is geography, jurisdiction, or another declared domain-space coordinate;
- `c_i` is category;
- `x_i` is the observed value or state produced by the derivation rule;
- `p_i` is provenance.

A signal fingerprint may be calculated as:

```text
f_i = H(g_i || c_i || x_i || p_i)
```

This supports deterministic identity, repeat detection, and controlled deduplication. It does not establish motive, guilt, causation, or a legal conclusion.

## Convergence

Declared signal values may be combined through a published weighted normalization:

```text
K = sum(w_i * q_i) / sum(w_i)
```

`q_i` is a normalized signal value and `w_i` is a declared weight. A convergence result means that declared signals converge under a known rule. Convergence is not causation.

## Live storage mapping

The current database contains multiple historical generations. Their names do not override their semantic role.

| Live object | Canonical role |
| --- | --- |
| `public.raw_records` | One legacy raw-record path; not a complete count of every streaming source observation. |
| `public.signal_events` | Compatibility-named normalized observation event store. One row is not automatically a civic signal. Its `signal_type` column is an adapter observation classification. |
| `atlas.signals` | Normalized Atlas signal records. |
| `atlas.signal_extractions` | Signal-derivation audit receipts linked to `atlas.signals`. Absence of a receipt must remain visible. |
| `atlas.live_data_signal_candidate` | Rule-derived signal candidates. Candidate status does not make the object a canonical signal, finding, or legal conclusion. |
| `atlas.convergence_signal_snapshot` | Immutable source, transformed-signal, and deduplicated-signal populations for a convergence run. |
| `atlas.convergence_run_manifest` | Run configuration, population hashes, engine/rule identities, and population counts. |
| `atlas.convergence_receipt` | Per-domain-space convergence receipt. |
| `atlas.convergence_events` | Persisted convergence-event layer; distinct from a computation receipt. |
| `public.prime_patterns` | Legacy investigation outputs. A `stream_health_alert` is operational telemetry, not a civic convergence conclusion. |

Compatibility identifiers such as `signal_events`, `signal_type`, resolver IDs, RPC names, hashes, and foreign keys remain stable until a separately governed migration changes them. Public read models translate those names into the canonical ontology without rewriting source history.

## Runtime invariants

1. Adapter execution changes observation counts, not signal counts.
2. Observation classification counts must never be labeled as civic signal types.
3. Signal counts require a named canonical signal store or a hash-bound transformed-signal snapshot.
4. Signal candidates remain separately counted from `atlas.signals`.
5. Source, transformed, and deduplicated populations remain separately counted in convergence receipts.
6. Stream-health alerts remain separately counted from civic convergence outputs.
7. Atlas stops before legal interpretation, verification ownership, consequence projection, or human decision.
8. Lighthouse presents Atlas outputs without silently redefining them.

## Current dated audit snapshot

The 2026-08-09 production audit found:

- 50,313 normalized observation events;
- 71 `atlas.signals` rows;
- 0 `atlas.signal_extractions` rows;
- 20 governed signal candidates under one rule family and two versions;
- 5 immutable convergence runs and 5 convergence receipts;
- 0 `atlas.convergence_events` rows;
- 13 legacy prime-pattern rows, all classified as `stream_health_alert`.

These are dated observations, not permanent constants. The UI must retrieve them live and preserve the distinctions above.

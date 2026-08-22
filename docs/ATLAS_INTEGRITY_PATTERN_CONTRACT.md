# Atlas governed integrity-pattern contract

## Ownership boundary

Atlas owns deterministic integrity-pattern derivation from canonical source observations. It persists rule versions, run receipts, evidence-bound candidates, currentness transitions, and the existing Domain 3 bridge receipt.

Lighthouse consumes the bridged Domain 3 candidate. It may present the evidence and collect human corroboration, contradiction review, lifecycle decisions, and draft-only agency routing. Lighthouse must not run an independent copy of the Atlas detector or reinterpret an observation candidate as a finding.

## Non-equivalence

The following states are never interchangeable:

1. Source observation
2. Exact identity binding
3. Integrity-pattern candidate
4. Corroborated reviewer assessment
5. Governed finding or legal conclusion
6. Draft or transmitted agency communication

An Atlas candidate is not proof of corruption, unlawful conduct, motive, causation, or liability. No Atlas rule transmits a complaint or selects an enforcement consequence.

## Rules

Atlas currently declares six additive integrity rules:

- phoenix continuity;
- exact identifier reuse;
- bounded financial conduit;
- legislative-financial convergence;
- source contradiction;
- source-declared numeric-range anomaly.

All rules fail closed when the required exact IDs, source record identities, timestamps, declared policy tags, or declared numeric bounds are absent. Names do not become identities. Topic overlap is never inferred from free text.

## Evidence and replay

Every persisted candidate must retain at least one Atlas `stream_id` + `offset` + `event_identity_hash` reference. Candidate and input hashes are deterministic. Complete replays may retire candidates that are no longer observed; truncated replays never reconcile currentness.

The Atlas-to-Lighthouse bridge carries the Atlas candidate UUID, candidate hash, semantic key, evidence references, and the unchanged `observation_candidate` governance state. Lighthouse stores a review projection of that identity; it does not mint a replacement detector identity or promote the candidate during transport.

Source adapters may provide `payload.integrity_observation` only when the required source-native or canonical IDs are present. Missing identity fields remain explicit gaps and produce no candidate.

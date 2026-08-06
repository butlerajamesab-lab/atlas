# Atlas ↔ Field Atlas Capability Reconciliation

**Status:** Active implementation ledger
**Date:** 2026-08-06
**Atlas source baseline:** current `main`
**Field Atlas reference baseline:** uploaded Field Atlas full implementation bundle, mathematical foundation, filter library, pattern lens library, module-template generator, cross-module tooling, and filter-stack resolver runtime.

## Governing rule

> Pull capability forward; never move canonical ownership sideways.

Field Atlas is a reference implementation and omnidirectionality proof suite. It is not to be merged wholesale into Atlas, and `field_atlas_*` substrate authority is not to be copied into Atlas.

Atlas remains the canonical domain-agnostic signal/convergence substrate. Existing Luminari platform ownership remains intact:

- Docket owns official legislative retrieval/history.
- Rosetta owns deterministic legal decomposition and source-bound structural objects.
- Civic Genome owns bill/family identity, version lineage, events, traits, and momentum.
- Atlas owns observations, normalization, relationship/convergence mathematics, domain-space transforms, and deterministic computation receipts.
- Prism owns verification status, contradiction/incompleteness, and replay verification receipts.
- Kaleidoscope owns cross-generation comparison/projection and consequence outputs.
- Lighthouse receives and presents without silently taking upstream ownership.

## Field Atlas reference architecture

The reference implementation demonstrates the following fixed chain:

```text
Source Registry
  → Adapter
  → Filter Stack
  → Pattern Lens
  → Agnostic Machine
  → Rule Card
  → Evidence Package
  → Action Routing
  → Outcome Learning
```

Cross-module proof artifacts demonstrate the same invariant runtime across radically different domains while preserving dry-run dispatch, public-release review, no-fabricated-law behavior, provenance, disconfirmation logic, hardened filter anti-bypass, immutable learning targets, and redaction defaults.

## Capability matrix

| Capability | Current Atlas state | Field Atlas reference | Atlas disposition | Priority |
|---|---|---|---|---|
| Universal signal representation | PRESENT | Invariant signal primitive | Preserve | P0 lock |
| Deterministic fingerprinting | PRESENT | SHA-256 signal fingerprint | Preserve | P0 lock |
| Temporal similarity/windows | PRESENT/PARTIAL | First-class temporal window primitive | Reconcile | P1 |
| Geographic normalization | PRESENT | Area-weighted normalized transforms | Preserve and verify | P0 lock |
| Generic domain-space abstraction | PARTIAL | Geographic/network/archive/market/orbital/hybrid spaces | Pull forward as Atlas-native `domain_space` contract | P0 |
| Convergence mathematics | PRESENT | Agnostic machine compatibility + convergence | Preserve | P0 lock |
| Immutable source/transformed/deduplicated snapshots | PRESENT | Runtime/audit requirement | Preserve | P0 lock |
| Atomic persistence + strict idempotency | PRESENT | Runtime/audit requirement | Preserve | P0 lock |
| Replay from persisted source snapshots | PRESENT | Runtime/audit requirement | Preserve | P0 lock |
| Source registry/readiness/health/fallbacks | PARTIAL | First-class source registry | Pull forward under Atlas-native authority | P1 |
| Adapter manifests and schema/source-health receipts | PARTIAL | Replaceable adapter runtime | Pull forward under Atlas-native authority | P1 |
| Deterministic filter-stack resolver | FIELD-ATLAS-ONLY/PARTIAL | Executable resolver + anti-bypass rules | Pull forward, bounded to Atlas computation context | P1 |
| Hardened filter anti-bypass | FIELD-ATLAS-ONLY | Mandatory protections and restrictive-wins | Pull forward where Atlas owns the protection; do not duplicate downstream publication policy | P1 |
| Pattern-lens runtime | FIELD-ATLAS-ONLY/PARTIAL | Executable weighted lens stacks | Pull forward as structural lenses only | P1 |
| Cross-domain signatures | PARTIAL | Formal shared-structure proof | Pull forward as Atlas structural recurrence receipts | P2 |
| Module assembly validator | FIELD-ATLAS-ONLY | Engine + lenses + adapters + sources + config | Pull forward as Atlas module-definition/validation contract | P2 |
| Module template generator | FIELD-ATLAS-ONLY | Executable scaffold generator | Pull forward after Atlas module contract exists | P3 |
| Cross-module invariant tooling | FIELD-ATLAS-ONLY | 22-invariant audit / omnidirectionality proof | Pull forward as permanent Atlas CI | P2 |
| Rule-card backbone | FIELD-ATLAS-ONLY | First-class rules system | DO NOT COPY. Bind to Rosetta/other governed rule owners in Luminari | Boundary lock |
| Evidence-package final truth product | FIELD-ATLAS-ONLY | Human-facing truth package runtime | DO NOT COPY WHOLESALE. Atlas emits computation receipts; Prism/Lighthouse retain verification/presentation ownership | Boundary lock |
| Action routing / dispatch | FIELD-ATLAS-ONLY | Proposed-only dry-run route runtime | DO NOT MAKE ATLAS AN AUTONOMOUS ROUTER. Preserve ranking math and route characteristics only | Boundary lock |
| Outcome learning | FIELD-ATLAS-ONLY/PARTIAL | Bounded self-healing proposals | Pull only auditable calibration proposals; no silent engine mutation | P3 |
| Public-release controls | FIELD-ATLAS-ONLY | Hardened review/redaction | Atlas may emit sensitivity/filter receipts; downstream owners enforce public-release policy | Boundary lock |

## P0 — First implementation: Atlas generic domain-space contract

### Why this is first

The original mathematical foundation is broader than conventional geography. Field Atlas proves that the same engine can operate over geography, networks, archives, process spaces, orbital parameter space, and mixed spaces. Atlas must not accidentally remain a GIS-shaped implementation of a more general mathematical contract.

### Required Atlas-native primitive

```text
domain_space_definition
  space_type
  coordinate_schema
  distance_or_similarity_rule
  normalization_rule
  transform_rule
  rule_version
  configuration_hash
```

### Initial supported space classes

- geographic
- network
- organizational
- procedural
- document_lineage
- hybrid

The contract must permit later registered space classes without engine mutation, including orbital or rank/skill spaces.

### Invariants

- Core convergence math does not contain domain-specific nouns.
- Every non-geographic comparison declares its distance/similarity contract.
- Scores remain bounded where declared.
- Same universal inputs under the same space rule/configuration produce the same output.
- Space rule/version/configuration identity is included in the run identity and receipt hash.
- Unsupported space semantics terminate explicitly; they are never guessed.
- Geographic behavior remains backward compatible.

### Legislative first-use target

Legislative history should be representable as a hybrid domain space composed from:

```text
jurisdiction
+ bill/version lineage
+ amendment sequence
+ actor/committee network
+ procedural stage
+ observed/effective time
```

Atlas computes relationships and convergence in that declared space. It does not own the underlying legal structure or lineage identities.

## P1 — Atlas-native source and adapter operating layer

Pull forward the generic capabilities demonstrated by Field Atlas:

- source identity;
- source family/type;
- owning entity;
- jurisdiction/coverage scope;
- access method;
- update cadence;
- provenance baseline;
- readiness score/band;
- source health and freshness;
- schema status/drift;
- known failure modes;
- fallback sources;
- adapter manifest/version;
- field mappings;
- emitted canonical objects;
- adapter run receipts;
- no silent record drops.

Do not create a second event/signal authority. Adapters feed existing Atlas canonical signal/event substrate.

## P1 — Atlas deterministic filter stack

Atlas filter resolution should preserve the Field Atlas structural rule:

```text
effective_filters
  = requested
  + module_required
  + domain_required
  + applicable_hardened
```

Atlas-owned filter categories should be limited to computation context:

- source/source-family;
- signal type;
- domain space;
- geography/jurisdiction;
- time window;
- actor/entity;
- relationship type;
- provenance/evidence quality;
- convergence window;
- deduplication/exclusion;
- sensitivity flags that affect Atlas-owned outputs.

Each receipt records requested, inserted, blocked, and effective filters.

## P1 — Structural pattern lenses

Pull the mechanism, not Field Atlas domain semantics.

Initial Atlas structural lenses:

- recurrence
- contradiction
- suppression
- amplification
- dependency
- authority_concentration
- burden_shift
- temporal_acceleration
- geographic_diffusion
- cross_jurisdiction_recurrence
- weak_joint
- orphaned_pathway
- disconfirmation

A convergence may activate multiple weighted lenses. Atlas reports the structural match and component evidence; Kaleidoscope owns consequence interpretation.

## P2 — Atlas module-definition contract

```text
atlas_module
  = domain_space_binding
  + adapter_bindings
  + signal_taxonomy
  + filter_requirements
  + structural_lens_stack
  + convergence_configuration
  + receipt_requirements
```

A module is never an engine fork.

## P2 — Omnidirectionality CI proof suite

Use radically different fixtures to prove the abstraction remains real:

1. Civic/accountability process
2. Meteorite recovery / physical geography
3. Rare-species habitat / sensitive ecology
4. Non-geographic orbital or rank-space fixture

Acceptance requirement: mathematically equivalent universal inputs produce equivalent invariant-engine results within declared tolerance, regardless of domain adapter/lens semantics.

## Atlas computation receipt target

Atlas should emit a bounded, replayable computation receipt rather than a duplicate final evidence authority:

- complete source population identity/hash;
- source/transformed/deduplicated snapshot identities;
- domain-space definition and rule version;
- requested/inserted/blocked/effective filters;
- structural lens stack and component activations;
- contributing signals;
- contradicting/disconfirming signals;
- unresolved signals;
- component scores;
- convergence score/status;
- engine/configuration/rule-manifest versions;
- complete input hash;
- complete output hash;
- replay identity/result.

## Explicit non-imports from Field Atlas

Do not copy these as new Atlas canonical authorities:

- `field_atlas_rule_cards` legal/policy truth system;
- final human-facing truth/evidence package authority;
- external dispatch/action-routing authority;
- public-release authorization;
- automatic self-modification of engine mathematics;
- domain-specific no-harm nouns as core engine logic.

## Execution order

1. [x] Recover Field Atlas reference implementation and mathematical foundation.
2. [x] Establish capability reconciliation and ownership boundary ledger.
3. [ ] Lock current Atlas mathematical/replay baseline with permanent source contract.
4. [ ] Implement Atlas generic domain-space contract with geographic backward compatibility.
5. [ ] Add domain-space identity to run/configuration/replay receipts.
6. [ ] Add Atlas-native source registry + adapter-health contracts.
7. [ ] Add deterministic Atlas filter-stack resolver.
8. [ ] Add structural pattern-lens runtime.
9. [ ] Add Atlas module-definition validator.
10. [ ] Add cross-domain equivalence/omnidirectionality CI suite.
11. [ ] Expand Atlas computation receipt.
12. [ ] Run legislative-history vertical slice using Rosetta + Civic Genome bindings.
13. [ ] Hand governed structural outputs to Kaleidoscope.
14. [ ] Evaluate bounded outcome-calibration proposals.

## First implementation acceptance gate

The domain-space change may proceed only if all are true:

- existing geographic convergence fixtures remain byte/hash stable where the new contract is not invoked;
- current replay receipts remain valid;
- no new domain authority tables duplicate existing canonical Atlas tables;
- a non-geographic fixture can execute using an explicit registered space rule;
- unsupported space configuration fails closed;
- run identity binds the space rule/configuration;
- no Luminari platform ownership is moved into Atlas.

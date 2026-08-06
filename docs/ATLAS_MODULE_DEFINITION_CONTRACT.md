# Atlas Module Definition Contract

**Version:** 1.0.0
**Status:** implementation candidate
**Date:** 2026-08-06

## Governing formula

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

A module is an assembly over the invariant Atlas engine. A module is never an engine fork.

## Required fields

### Identity
- `module_id`
- `module_version`
- `core_question`

### Domain-space binding
A complete registered Atlas `domain_space_definition`.

### Adapter bindings
Every adapter binding must name exact canonical identities:
- `connector_id`
- `schema_id`
- `adapter_class`
- `role`
- `required`

No fuzzy connector or adapter matching is permitted.

### Signal taxonomy
Each module declares domain-specific signal names and their universal structural roles. The module vocabulary remains outside the invariant engine.

### Filter requirements
Module/domain requirements resolve through the Atlas deterministic filter-stack runtime. Atlas hardened integrity filters remain mandatory.

### Structural lens stack
A module declares an explicit weighted structural lens stack. High-impact modules can require disconfirmation. Structural lenses describe observed structures; they do not own legal meaning or consequence interpretation.

### Convergence configuration
Only declared convergence parameters are accepted:
- rule identity;
- minimum signal count;
- time window;
- similarity threshold;
- deterministic deduplication rule.

Unknown hidden adjustments fail closed.

### Receipt requirements
A module may require only registered Atlas computation receipts:
- source population hash;
- deduplicated population hash;
- domain-space receipt;
- filter-stack receipt;
- structural-lens receipt;
- complete output hash;
- replay receipt.

## Operational validation

Compilation proves the module contract is structurally valid. Activation additionally requires an explicit registry snapshot proving each required connector/schema/adapter binding is present and active.

Operational states:
- `ready`
- `degraded`
- `blocked`

A missing or mismatched required adapter binding blocks the module. Atlas does not search for a similarly named replacement.

## Omnidirectionality acceptance

Atlas must continuously prove that radically different domains can compile under this same contract without changing the engine.

Permanent reference fixture classes:
1. civic/process topology;
2. meteorite/physical geography;
3. rare-species/sensitive geography;
4. continuous non-geographic normalized parameter space.

For mathematically equivalent normalized inputs using the same registered comparison rule/configuration, invariant mathematical outputs must be equivalent even when domain adapter semantics differ. Source/schema identities remain distinct in receipts.

## Ownership boundary

Atlas module definitions may bind external governed identities but do not acquire their canonical ownership.

- Docket owns official legislative source/history.
- Rosetta owns legal decomposition.
- Civic Genome owns bill/family lineage.
- Prism owns verification.
- Kaleidoscope owns consequence interpretation.
- Lighthouse owns presentation.

Atlas owns the deterministic assembly definition, computation context, structural relationships/convergence, and receipts.

# Atlas Domain-Space Contract

**Version:** 0.1.0
**Status:** implementation target
**Date:** 2026-08-06

## Purpose

Atlas mathematics is domain-agnostic. Conventional geography is one space implementation, not the ontology itself.

This contract defines the minimum deterministic interface for any Atlas comparison space without changing the invariant convergence engine.

## Canonical object

```json
{
  "space_type": "geographic | network | organizational | procedural | document_lineage | hybrid | registered_extension",
  "coordinate_schema": "versioned schema identifier",
  "distance_or_similarity_rule": "versioned rule identifier",
  "normalization_rule": "versioned rule identifier or null",
  "transform_rule": "versioned rule identifier or null",
  "rule_version": "semantic version",
  "configuration": {},
  "configuration_hash": "sha256"
}
```

## Invariants

1. Atlas core never infers space semantics from domain nouns.
2. Every non-geographic comparison must declare an explicit distance or similarity rule.
3. Every registered rule must declare its score range and deterministic behavior.
4. Bounded similarities must be validated to their declared range.
5. Same coordinates + same rule + same configuration + same engine version produce the same result.
6. Run/replay identity must bind space rule identity and configuration hash.
7. Unsupported or malformed space definitions fail closed.
8. Geographic behavior is backward compatible when no domain-space override is supplied.
9. Domain-specific mappings belong to adapters/modules, not the invariant engine.
10. Atlas may emit structural relationship receipts; downstream platforms retain their canonical ownership.

## Initial space classes

### geographic

Existing geographic coordinates, geography registry, normalized area transforms, Haversine/geodesic behavior, and governed geography partitions remain canonical.

### network

Coordinates are node identities plus a declared network snapshot. Distance/similarity is supplied by a registered deterministic network rule, such as shortest-path distance or adjacency-kernel similarity.

### organizational

Coordinates represent actors/units in a declared organizational graph snapshot. This is a specialization of network space with explicit organization/authority metadata owned by source bindings, not by the engine.

### procedural

Coordinates represent stages, transitions, deadlines, or states in a declared workflow/process graph. Distance is defined by the registered process topology, not ordinary geography.

### document_lineage

Coordinates represent immutable document/version nodes and lineage edges. This supports comparison across bill versions, amendments, rejected amendments, supersession, and other governed document generations without making Atlas the owner of those identities.

### hybrid

A hybrid space declares multiple component spaces and an explicit deterministic composition rule. No component may be silently added.

Example legislative hybrid:

```text
jurisdiction
+ document lineage
+ amendment sequence
+ actor/committee network
+ procedural stage
+ observed/effective time
```

## Registry contract

A domain-space rule registry entry must include:

- `rule_id`
- `space_type`
- `rule_version`
- `input_schema`
- `output_type`
- `score_range`
- `deterministic = true`
- `implementation_ref`
- `configuration_schema`
- `created_at`
- `retired_at` or null

## Receipt binding

Every computation that uses a domain-space rule must include:

- `space_type`
- `space_rule_id`
- `space_rule_version`
- `space_configuration_hash`
- `coordinate_population_hash`
- component score(s)
- final normalized score where applicable

These fields must contribute to the complete run/input identity.

## Failure states

Required explicit failures include:

- `domain_space_definition_missing`
- `domain_space_rule_not_registered`
- `domain_space_rule_version_mismatch`
- `domain_space_coordinate_invalid`
- `domain_space_configuration_invalid`
- `domain_space_score_out_of_range`
- `domain_space_transform_not_supported`

No fallback to geographic distance is permitted for a non-geographic space.

## Ownership boundary

Atlas owns the space contract, mathematical comparison, and computation receipt.

Atlas does not silently take ownership of:

- Docket legislative identities;
- Rosetta legal structure;
- Civic Genome lineage/family truth;
- Prism verification state;
- Kaleidoscope consequence interpretation.

External canonical identities enter through source/adapter bindings and remain source-bound.

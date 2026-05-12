# Luminari Five-Substrate Platform Model

Date: 2026-05-12

## Platform Thesis

Luminari is five substrates moving as one platform.

The product arc is:

> Harm → Pattern → Structure → Law → Action

The human voice is:

> I believe you. You were there. Let's look at what they actually did.

This matters for recovery because Luminari is not one interchangeable application database. It is a coordinated civic-forensic system with distinct substrate ownership, provenance boundaries, and action authority.

---

## The Five Substrates

| Substrate | Project | Region | Role | Authority Boundary |
| --- | --- | --- | --- | --- |
| Atlas | `bjdjjgnkhxblnpdrjqtw` | us-east-1 | Map, jurisdictions, agencies, resources, statutes, case law, civic metrics | Atlas reads from no one; everyone reads from Atlas |
| Lighthouse | `wepxlinwbjrkqdzkqpar` | us-west-2 | Harm intake, public-stream ingestion, signal detection, governance gate, clustering, pattern detection | Witnesses and detects signals; does not assert case truth |
| Prism | `ckkvxfqqakdzrcbmdimy` | us-east-1 | Validated findings, friction scoring, correlation, escalation routes, deterministic case bundles | No verified truth → no system presence → no action → no escalation |
| Rosetta | `kjzytnzkkdpdxtqtjlew` | us-east-1 | Law/service/template translation into workflow constants, deadlines, forms, accountability routes | Turns law and services into executable constants |
| Esquire | `eombkfyeymqqjanlunal` | us-east-1 | Pro se litigant assistant, offline-first court support, crisis-aware capture, user-owned case view | Built for the person alone, offline, and possibly in crisis |

---

## Substrate Responsibilities

### Atlas — The Map

Atlas is the floor under the platform. It owns the country as usable civic structure: jurisdictions, agency metrics, civic resources, signal events, statutes, and case law. Its deterministic, domain-agnostic mathematical substrate is defined in `docs/ATLAS_MATHEMATICAL_FOUNDATION.md`.

Atlas must remain the canonical source for shared reference geography, jurisdictional context, civic resources, agency metrics, legal references, and public backbone data. Lighthouse may currently carry some reference data during recovery, but that is cleanup debt, not final ownership.

Geographic equity is an architectural rule: every jurisdiction, tribal nation, and reservation should receive the same modeled data depth regardless of federal recognition or population size.

### Lighthouse — The Witness and Pattern Gate

Lighthouse is where harm enters the system.

It has two doors:

1. individual intake: documents, photos, denial letters, narratives, voice memos, and case materials
2. public/live streams: agency, court, enforcement, FOIA, labor, safety, and consumer records

Both doors feed the same deterministic path:

1. Ingestion
2. Normalization
3. Signal Detection
4. Governance Gate
5. Signal Registry
6. Clustering
7. Pattern Detection

The Governance Gate is load-bearing. Signals failing the gate are discarded, not merely flagged.

Lighthouse does not declare a person's case true. It witnesses, preserves source attribution, detects signals, and cross-references individual harm against public/systemic patterns.

### Prism — The Refraction and Escalation Substrate

Prism validates findings and turns them into escalation-ready structure.

It owns deterministic interpretation of validated findings, friction scoring, correlation, coordination-pattern detection, jurisdiction-conflict resolution, enrichment, and packetized escalation routes.

Escalation must remain sequential and governed. No state may be skipped, and packet hashes must make deliverables reproducible and externally verifiable.

Prism's governing rule is truth enforcement:

> No verified truth → no system presence → no action → no escalation.

Prism outputs organized evidence and procedural support. It does not cross the causal/legal-advice firewall.

### Rosetta — The Law-to-Constants Substrate

Rosetta translates law, services, and templates into executable constants.

It takes source text and produces workflow steps, deadlines, forms, accountability routes, appeal pathways, escalation nodes, term definitions, and layer coverage.

If Atlas holds law and civic references as source material, Rosetta operationalizes them as platform behavior: what to do, when to do it, what form to use, which agency receives it, and what fallback exists if the first path fails.

### Esquire — The Pro Se Action Substrate

Esquire is built for the person walking into court alone.

Its design assumptions are structural:

- the user is alone, so case data is user-owned and locked down by default
- the user may be offline, so capture and sync must work without continuous connectivity
- the user may be in crisis, so the interface must reduce cognitive load instead of demanding analysis

In crisis mode, action should narrow to capture and preservation: record, tag, save. Analysis and review can wait until the person is safer.

Esquire carries the final action posture: the person can walk procedure, produce usable bundles, and preserve their own account without the platform over-claiming what it can prove.

---

## Unified Platform Flow

| Step | Owner | What Happens |
| --- | --- | --- |
| Harm | Outside the platform | Something happens to a person |
| Pattern | Lighthouse | Their case and public streams produce governed signals |
| Structure | Prism | Signals become validated findings, relationships, bundles, and escalation routes |
| Law | Atlas + Rosetta | Atlas supplies the map and source law; Rosetta converts law/services/templates into constants |
| Action | Esquire | The pro se user walks the procedure, offline or in crisis if necessary |

---

## Recovery Implications

Recovery must respect substrate ownership.

Do not collapse all five substrates into one replacement schema. Do not let one database rebuild overwrite another substrate's authority. Do not treat Lighthouse's current recovery state as the full platform boundary.

Correct recovery means:

- preserve each Supabase project lineage independently
- inventory each substrate's tables before migration or cleanup
- move reference data toward Atlas ownership instead of duplicating it in Lighthouse
- keep Lighthouse focused on intake, signals, governance, clustering, and pattern detection
- use Atlas mathematical primitives for cross-domain signal fingerprints, convergence detection, geographic normalization, linking, and prioritization
- keep Prism responsible for validation and escalation only after verified truth exists
- keep Rosetta responsible for executable legal/service/template constants
- keep Esquire responsible for user-owned, offline-first, crisis-aware pro se action
- document cross-substrate reads and writes explicitly

The platform becomes coherent when these substrates move together without violating each other's authority boundaries.

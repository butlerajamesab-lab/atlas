# Atlas database ruleset proposal

## Current observation

As retrieved on 2026-08-30, `butlerajamesab-lab/atlas` has no active branch
protection or repository ruleset on `main`. Supabase integration messages are
comments, not required status checks, so a failed or capacity-rejected preview
does not currently prevent a merge.

This document is a proposal only. The repair PR must stay draft and unmerged,
and the repository ruleset must not be activated until its acceptance receipt
and final `database-migration-gate` check pass.

## Proposed ruleset

| Setting | Proposed value |
| --- | --- |
| Name | `atlas-main-fail-closed` |
| Enforcement | Active after PR #68 acceptance |
| Target | Default branch, resolving to `refs/heads/main` |
| Pull request required | Yes |
| Required check | `database-migration-gate` from GitHub Actions |
| Branch deletion | Blocked |
| Non-fast-forward update | Blocked |
| Force push | Blocked |
| Required conversation resolution | Yes |
| Bypass | No routine bypass; emergency repository-admin bypass must be audited |

The required check is path-aware internally: any SQL file, canonical Supabase
boundary file, migration validator/generator/verifier, or database workflow
change runs an empty PostgreSQL 17 replay, pgTAP, error-level database lint,
dirty no-op replay, and a second clean replay. A reviewed ready-state receipt
is then verified against the successful candidate replay job and hosted preview
evidence.

For a single-maintainer repository, requiring one approving reviewer can create
an impossible self-approval loop. Enable a one-review minimum only after a
second eligible reviewer or review team exists; until then, keep the PR and
conversation requirements plus the fail-closed required check.

## Adoption checklist

1. Confirm the final draft PR head has a green `database-migration-gate`.
2. Confirm `main` still points to the audited base and resolve any intervening
   changes by rerunning acceptance.
3. Create the ruleset with the exact required-check name above.
4. Test the rule with a disposable documentation PR and a disposable
   database-bearing PR before merging Atlas repair work.
5. Record any emergency bypass as a linked issue or incident receipt.

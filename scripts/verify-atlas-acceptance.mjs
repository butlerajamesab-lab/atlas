import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = 'supabase/migration-manifest.json';
const evidencePath = 'supabase/evidence/hosted-preview-acceptance.json';
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const finalMetadataPaths = new Set([
  'supabase/README.md',
  manifestPath,
  evidencePath,
]);
const requiredReplaySteps = [
  'Replay every canonical migration from empty',
  'Verify prerequisite schema, extensions, RLS, and grants',
  'Fail on database lint errors',
  'Prove dirty database replay is a no-op',
  'Repeat clean replay to detect dirty or order-dependent state',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalChainSha256(migrations) {
  return sha256(
    migrations
      .map((entry) => [
        entry.path,
        entry.version,
        entry.name,
        entry.kind,
        entry.sha256,
      ].join('\x1f'))
      .join('\x1e'),
  );
}

function orderedVersionNameSha256(migrations) {
  return sha256(
    migrations
      .map((entry) => [entry.version, entry.name].join('\x1f'))
      .join('\x1e'),
  );
}

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readJson(repositoryPath) {
  return JSON.parse(readFileSync(path.join(root, repositoryPath), 'utf8'));
}

function eventHeadSha() {
  if (commitPattern.test(process.env.ATLAS_ACCEPTANCE_HEAD_SHA ?? '')) {
    return process.env.ATLAS_ACCEPTANCE_HEAD_SHA;
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const sha = event.pull_request?.head?.sha;
    if (commitPattern.test(sha ?? '')) return sha;
  }
  return git(['rev-parse', 'HEAD']);
}

function normalizedReadyManifest(currentManifest, candidateManifest) {
  const normalized = structuredClone(currentManifest);
  normalized.canonical.status = candidateManifest.canonical.status;
  normalized.productionEvidence.ledgerReconciliationStatus =
    candidateManifest.productionEvidence.ledgerReconciliationStatus;
  normalized.foundationalDependencyClosure.status =
    candidateManifest.foundationalDependencyClosure.status;
  delete normalized.acceptanceEvidence;
  for (let index = 0; index < normalized.blockers.length; index += 1) {
    normalized.blockers[index].status = candidateManifest.blockers[index].status;
    normalized.blockers[index].disposition =
      candidateManifest.blockers[index].disposition;
  }
  return normalized;
}

function validateStaticEvidence(manifest, evidence) {
  const errors = [];
  const migrations = manifest.canonical.migrations ?? [];
  const expectedChain = canonicalChainSha256(migrations);
  const expectedLedger = orderedVersionNameSha256(migrations);
  const checks = [
    [evidence.schemaVersion === 1, 'acceptance schemaVersion must be 1'],
    [evidence.subject?.repository === 'butlerajamesab-lab/atlas', 'acceptance repository is wrong'],
    [commitPattern.test(evidence.subject?.candidateCommitSha ?? ''), 'candidate commit SHA is invalid'],
    [commitPattern.test(evidence.subject?.candidateTreeSha ?? ''), 'candidate tree SHA is invalid'],
    [evidence.subject?.canonicalRoot === 'supabase/migrations', 'canonical root is wrong'],
    [evidence.subject?.canonicalMigrationCount === migrations.length, 'canonical count differs from the manifest'],
    [evidence.subject?.canonicalChainSha256 === expectedChain, 'canonical chain digest differs from the manifest'],
    [evidence.productionBoundary?.mode === 'read_only', 'production boundary was not read-only'],
    [evidence.productionBoundary?.productionProjectRef === 'bjdjjgnkhxblnpdrjqtw', 'production project ref is wrong'],
    [evidence.productionBoundary?.productionMigrationCount === 49, 'production ledger must remain at 49'],
    [evidence.localVerification?.headSha === evidence.subject?.candidateCommitSha, 'local verification is not bound to the candidate'],
    [evidence.localVerification?.jobName === 'database-replay-evidence', 'local verification job name is wrong'],
    [Number.isInteger(evidence.localVerification?.runId) && evidence.localVerification.runId > 0, 'workflow run ID is invalid'],
    [Number.isInteger(evidence.localVerification?.jobId) && evidence.localVerification.jobId > 0, 'workflow job ID is invalid'],
    [evidence.localVerification?.postgresMajorVersion === 17, 'local replay was not PostgreSQL 17'],
    [evidence.localVerification?.pgTap?.planned === 56, 'pgTAP plan must be 56'],
    [evidence.localVerification?.pgTap?.executed === 56, 'pgTAP must execute all 56 assertions'],
    [evidence.localVerification?.pgTap?.failed === 0, 'pgTAP failures are not accepted'],
    [evidence.localVerification?.lint?.errorCount === 0, 'database lint errors are not accepted'],
    [evidence.localVerification?.dirtyReplay?.conclusion === 'success', 'dirty replay did not pass'],
    [evidence.localVerification?.secondCleanReplay?.conclusion === 'success', 'second clean replay did not pass'],
    [evidence.hostedPreview?.productionProjectRef === 'bjdjjgnkhxblnpdrjqtw', 'preview production mapping is wrong'],
    [evidence.hostedPreview?.previewProjectRef === 'pfslrupnskktspdaayfq', 'preview project ref is wrong'],
    [evidence.hostedPreview?.previewProjectRef !== evidence.hostedPreview?.productionProjectRef, 'preview ref equals production'],
    [evidence.hostedPreview?.headSha === evidence.subject?.candidateCommitSha, 'hosted preview is not bound to the candidate'],
    [evidence.hostedPreview?.postgresVersion === '17.6', 'hosted preview is not PostgreSQL 17.6'],
    [evidence.hostedPreview?.migrationCount === migrations.length, 'hosted preview migration count differs'],
    [evidence.hostedPreview?.orderedVersionNameSha256 === expectedLedger, 'hosted preview ledger digest differs'],
    [evidence.hostedPreview?.catalogCounts?.tables === 114, 'hosted table count differs'],
    [evidence.hostedPreview?.catalogCounts?.views === 61, 'hosted view count differs'],
    [evidence.hostedPreview?.catalogCounts?.columns === 2514, 'hosted column count differs'],
    [evidence.hostedPreview?.catalogCounts?.constraints === 425, 'hosted constraint count differs'],
    [evidence.hostedPreview?.catalogCounts?.indexes === 451, 'hosted index count differs'],
    [evidence.hostedPreview?.catalogCounts?.sequences === 34, 'hosted sequence count differs'],
    [evidence.hostedPreview?.catalogCounts?.functions === 78, 'hosted function count differs'],
    [evidence.hostedPreview?.catalogCounts?.triggers === 16, 'hosted trigger count differs'],
    [evidence.hostedPreview?.catalogCounts?.policies === 45, 'hosted policy count differs'],
    [evidence.hostedPreview?.retiredFunctionsPresent === 0, 'retired functions remain in preview'],
    [evidence.hostedPreview?.retiredTriggersPresent === 0, 'retired triggers remain in preview'],
    [evidence.securityAdvisors?.errorCount === 0, 'security advisor errors are not accepted'],
    [evidence.securityAdvisors?.warningCount === 0, 'security advisor warnings are not accepted'],
    [evidence.securityAdvisors?.infoCount === 26, 'security advisor INFO count differs'],
    [evidence.securityReview?.applicationOwnerRole === 'postgres', 'application owner invariant is absent'],
    [evidence.securityReview?.postgresDefaultAclLeakCount === 0, 'postgres-owned default ACL leaks remain'],
    [evidence.securityReview?.serviceRoleDefaultAclPairs === 9, 'service-role default ACL coverage differs'],
    [evidence.decision?.status === 'accepted', 'acceptance decision is not accepted'],
    [evidence.decision?.productionMutated === false, 'acceptance receipt reports a production mutation'],
  ];
  for (const [condition, message] of checks) if (!condition) errors.push(message);
  return errors;
}

async function githubJson(repository, endpoint, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub ${endpoint} returned ${response.status}`);
  return response.json();
}

async function main() {
  const manifest = readJson(manifestPath);
  if (manifest.canonical?.status !== 'ready') {
    console.log('Atlas acceptance attestation: not applicable while baseline is candidate.');
    return;
  }

  const errors = [];
  if (!existsSync(path.join(root, evidencePath))) {
    errors.push(`missing ${evidencePath}`);
  }
  const evidence = errors.length === 0 ? readJson(evidencePath) : {};
  if (errors.length === 0) errors.push(...validateStaticEvidence(manifest, evidence));

  const descriptor = manifest.acceptanceEvidence ?? {};
  if (descriptor.path !== evidencePath) errors.push('manifest acceptance evidence path is wrong');
  const evidenceBytes = errors.length === 0 || existsSync(path.join(root, evidencePath))
    ? readFileSync(path.join(root, evidencePath))
    : Buffer.alloc(0);
  const evidenceHash = sha256(evidenceBytes);
  if (!sha256Pattern.test(descriptor.sha256 ?? '') || descriptor.sha256 !== evidenceHash) {
    errors.push('manifest acceptance evidence hash differs from the receipt');
  }

  const candidate = evidence.subject?.candidateCommitSha;
  const candidateTree = evidence.subject?.candidateTreeSha;
  if (commitPattern.test(candidate ?? '')) {
    try {
      if (git(['rev-parse', `${candidate}^{tree}`]) !== candidateTree) {
        errors.push('candidate tree does not match the acceptance receipt');
      }
      if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
        const currentHead = eventHeadSha();
        const parents = git(['rev-list', '--parents', '-n', '1', currentHead])
          .split(/\s+/).slice(1);
        if (parents.length !== 1 || parents[0] !== candidate) {
          errors.push('ready PR head must be exactly one metadata commit after the accepted candidate');
        }
        const changedPaths = git(['diff', '--name-only', candidate, currentHead])
          .split(/\r?\n/).filter(Boolean);
        for (const changedPath of changedPaths) {
          if (!finalMetadataPaths.has(changedPath)) {
            errors.push(`ready commit changes non-metadata path: ${changedPath}`);
          }
        }
        for (const requiredPath of [manifestPath, evidencePath]) {
          if (!changedPaths.includes(requiredPath)) {
            errors.push(`ready commit must change ${requiredPath}`);
          }
        }
      }
      const candidateManifest = JSON.parse(
        git(['show', `${candidate}:${manifestPath}`]),
      );
      if (!isDeepStrictEqual(
        normalizedReadyManifest(manifest, candidateManifest),
        candidateManifest,
      )) {
        errors.push('ready manifest changes fields outside the acceptance allowlist');
      }
    } catch (error) {
      errors.push(`could not verify acceptance ancestry: ${error.message}`);
    }
  }

  if (!process.argv.includes('--offline')) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) errors.push('GITHUB_TOKEN is required for acceptance attestation');
    if (token && errors.length === 0) {
      try {
        const repository = evidence.subject.repository;
        const run = await githubJson(
          repository,
          `actions/runs/${evidence.localVerification.runId}`,
          token,
        );
        if (run.head_sha !== candidate || run.status !== 'completed') {
          errors.push('recorded workflow run is not a completed candidate run');
        }
        const job = await githubJson(
          repository,
          `actions/jobs/${evidence.localVerification.jobId}`,
          token,
        );
        if (
          job.name !== 'database-replay-evidence' ||
          job.conclusion !== 'success' ||
          !String(job.run_url ?? '').endsWith(`/actions/runs/${evidence.localVerification.runId}`)
        ) {
          errors.push('recorded replay-evidence job is not a successful job from the recorded run');
        }
        for (const stepName of requiredReplaySteps) {
          const step = job.steps?.find((entry) => entry.name === stepName);
          if (step?.conclusion !== 'success') {
            errors.push(`recorded replay step did not succeed: ${stepName}`);
          }
        }
      } catch (error) {
        errors.push(`could not verify GitHub replay evidence: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Atlas acceptance attestation: PASS; candidate=${candidate}; ` +
    `migrations=${manifest.canonical.migrations.length}; preview=${evidence.hostedPreview.previewProjectRef}`,
  );
}

await main();

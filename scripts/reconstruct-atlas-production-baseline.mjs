import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceRoot = path.join(
  root,
  'supabase/evidence/current-production-catalog',
);
const migrationRoot = path.join(root, 'supabase/migrations');
const ledgerPath = path.join(
  root,
  'supabase/evidence/production-migration-ledger.json',
);
const reconstructionPath = path.join(
  root,
  'supabase/evidence/current-production-catalog/reconstruction-manifest.json',
);
const FORWARD_REPAIR_VERSION = '20260830210636';
const FORWARD_REPAIR_NAME = 'atlas_operational_rebuild_hardening';
const boundaryManifestPath = path.join(
  root,
  'supabase/migration-manifest.json',
);

const PRODUCTION_COMPONENT_FINGERPRINTS = {
  schemas: 'e0512b57c118b4b774e32fcddd9b65230ad94cd71ecc7f4ef35ab30238f645f0',
  relations: 'ed3e07b6d4c346d7ea8c995b51772dcda559a39750d087762688c86725291c23',
  columns: '29805f3dae118f84462347216960ca34a10cb901112f8a29207597d8993ae730',
  constraints: 'cc32e1d7d28f26c7fa5f89e40b34f714d3e6df6ed00b6418f674b87b94c94099',
  indexes: '515f841227de8504eb7acd4c35189805fa8f6ecc9266a98610e186436603245a',
  sequences: '9c1b981d3ffaa5a4538f154a136f15e92646a900dcad35d19d6bd4b39c6ec522',
  functions: '48fcabfffa789540744406f4c4d73c5deef5d8e1c5d5a66819f3a6d546a36f11',
  views: 'de82f7a2cfadc31b1cab878714cf92fcd94b37de272278573a6f773bc279800c',
  triggers: '3ad6133c0ebf821e21bce544ac4e63dc2f97d9a253069b6f82cf239d73c0f439',
  policies: 'c6fa78a8c2f70e1b7b7e09f58b6be56c8004f3951e2156847b54497bc7a1d477',
  comments: '4f54ded9f863357795878f885981de68943e86dac2a33b4d7bd33afe36a37cff',
};

const RETIRED_FUNCTIONS = new Set([
  'atlas.compute_entity_risk_tier(p_entity_id character varying)',
  'atlas.bridge_emit_signal_v1()',
  'atlas.bridge_escalate_convergence(p_convergence_event_id uuid)',
  'atlas.bridge_escalate_detection_rule(p_rule_id character varying, p_matched_record_ids text[], p_additional_context jsonb)',
  'atlas.bridge_push_action_to_lighthouse()',
  'atlas.bridge_push_resources_to_lighthouse()',
  'atlas.bridge_push_signal_to_lighthouse()',
  'atlas.bridge_push_signal_to_lighthouse(p_queue_id bigint)',
  'atlas.bridge_push_to_prism(p_title text, p_description text, p_jurisdiction text, p_finding_summary text, p_finding_confidence text, p_finding_metadata jsonb, p_recommendation_action text, p_recommendation_summary text, p_source_table text, p_source_record_id text)',
  'atlas.bridge_rebuild_map_pins()',
  'atlas.bridge_sync_all_to_lighthouse()',
  'atlas.bridge_sync_all_to_lighthouse_v3()',
  'atlas.bridge_sync_entity_to_lighthouse()',
  'atlas.bridge_sync_to_rosetta(p_provider_id character varying, p_batch_size integer)',
  'atlas.trigger_queue_bridge_v3()',
  'atlas.trigger_queue_pdf_extraction()',
  'public.get_connector_status(connector_name text)',
  'public.trigger_lighthouse_bridge_for_prime_pattern_v1(p_signal jsonb, p_audit_context jsonb, p_process_queue boolean)',
]);

const RETIRED_TRIGGERS = new Set([
  'atlas.action_queue.trg_bridge_action',
  'atlas.civic_map_signals.trg_queue_bridge_v3',
  'atlas.civic_map_signals.trg_bridge_emit_signal_v1',
  'atlas.entity_registry.trg_bridge_entity',
]);

const SERVICE_ONLY_FUNCTIONS = [
  'atlas.bridge_sync_to_lighthouse(p_signal_id bigint, p_batch_size integer)',
  'atlas.log_provenance()',
  'public.get_lighthouse_signal_events(p_stream_id text, p_offset bigint, p_limit integer)',
  'public.get_lighthouse_stream_definition(p_stream_id text)',
];

function readJson(repositoryPath) {
  return JSON.parse(readFileSync(path.join(root, repositoryPath), 'utf8'));
}

function qident(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function qname(schema, name) {
  return `${qident(schema)}.${qident(name)}`;
}

function qliteral(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function roleSql(role) {
  return String(role).toUpperCase() === 'PUBLIC' ? 'PUBLIC' : qident(role);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function endStatement(value) {
  const trimmed = value.trimEnd();
  return trimmed.endsWith(';') ? trimmed : trimmed + ';';
}

function qualifyExtensionCalls(sql) {
  return sql
    .replace(/(?<![A-Za-z0-9_."])(uuid_generate_v4)\s*\(/g, 'extensions.$1(')
    .replace(/(?<![A-Za-z0-9_."])(uuid_generate_v5)\s*\(/g, 'extensions.$1(')
    .replace(/(?<![A-Za-z0-9_."])(digest)\s*\(/g, 'extensions.$1(');
}

function loadCatalog() {
  const files = readdirSync(evidenceRoot).sort();
  const tables = files
    .filter((file) => file.startsWith('tables-'))
    .flatMap((file) => readJson(
      'supabase/evidence/current-production-catalog/' + file,
    ).relations);
  const functions = files
    .filter((file) => file.startsWith('functions-'))
    .flatMap((file) => readJson(
      'supabase/evidence/current-production-catalog/' + file,
    ).functions);
  const views = files
    .filter((file) => file.startsWith('views-'))
    .flatMap((file) => readJson(
      'supabase/evidence/current-production-catalog/' + file,
    ).views);
  return {
    tables,
    functions,
    views,
    sequences: readJson(
      'supabase/evidence/current-production-catalog/sequences.json',
    ).sequences,
    triggers: readJson(
      'supabase/evidence/current-production-catalog/triggers.json',
    ).triggers,
    schemaState: readJson(
      'supabase/evidence/current-production-catalog/schemas-and-default-acls.json',
    ).schema_state,
    extensions: readJson(
      'supabase/evidence/current-production-catalog/extensions.json',
    ).extensions,
    types: readJson(
      'supabase/evidence/current-production-catalog/types.json',
    ).types,
    publicationState: readJson(
      'supabase/evidence/current-production-catalog/publications.json',
    ).publication_state,
  };
}

function objectGrantSql(kind, objectName, owner, grants) {
  const relevant = grants.filter((grant) => grant.grantee !== owner);
  const grantees = [...new Set([
    'PUBLIC',
    'anon',
    'authenticated',
    'service_role',
    ...relevant.map((grant) => grant.grantee),
  ])];
  const sql = [
    `revoke all privileges on ${kind} ${objectName} from ${grantees.map(roleSql).join(', ')};`,
  ];

  const groups = new Map();
  for (const grant of relevant) {
    const key = `${grant.grantee}\x1f${grant.grantable}`;
    const privileges = groups.get(key) ?? [];
    privileges.push(grant.privilege.toLowerCase());
    groups.set(key, privileges);
  }

  for (const [key, privileges] of groups) {
    const [grantee, grantable] = key.split('\x1f');
    sql.push(
      `grant ${[...new Set(privileges)].sort().join(', ')} on ${kind} ` +
      `${objectName} to ${roleSql(grantee)}` +
      (grantable === 'true' ? ' with grant option;' : ';'),
    );
  }
  return sql;
}

function functionSignature(fn) {
  return `${qname(fn.schema, fn.name)}(${fn.identity_arguments})`;
}

function functionKey(fn) {
  return `${fn.schema}.${fn.name}(${fn.identity_arguments})`;
}

function topologicalViews(views) {
  const byKey = new Map(views.map((view) => [
    `${view.schema}.${view.name}`,
    view,
  ]));
  const pending = new Set(byKey.keys());
  const emitted = new Set();
  const ordered = [];

  while (pending.size > 0) {
    const ready = [...pending]
      .filter((key) => {
        const view = byKey.get(key);
        return (view.dependencies ?? [])
          .filter((dependency) => dependency.relkind === 'v')
          .map((dependency) => `${dependency.schema}.${dependency.name}`)
          .filter((dependency) => byKey.has(dependency))
          .every((dependency) => emitted.has(dependency));
      })
      .sort();

    if (ready.length === 0) {
      throw new Error(
        'view dependency cycle or incomplete dependency capture: ' +
        [...pending].sort().join(', '),
      );
    }
    for (const key of ready) {
      ordered.push(byKey.get(key));
      pending.delete(key);
      emitted.add(key);
    }
  }
  return ordered;
}

function defaultAclSql(schemaState) {
  const objectKinds = new Map([
    ['r', 'tables'],
    ['S', 'sequences'],
    ['f', 'functions'],
  ]);
  const output = [];

  for (const entry of schemaState.default_acls) {
    // Supabase owns and manages supabase_admin defaults. The hosted postgres
    // migration role is not a member of supabase_admin and cannot replay them.
    if (entry.owner !== 'postgres') continue;
    const kind = objectKinds.get(entry.object_type);
    if (!kind) continue;
    const relevant = entry.grants.filter(
      (grant) => grant.grantee !== entry.owner,
    );
    const grantees = [...new Set([
      'PUBLIC',
      'anon',
      'authenticated',
      'service_role',
      ...relevant.map((grant) => grant.grantee),
    ])];
    for (const grantee of grantees) {
      output.push(
        `alter default privileges for role ${qident(entry.owner)} ` +
        `in schema ${qident(entry.schema)} revoke all on ${kind} ` +
        `from ${roleSql(grantee)};`,
      );
    }

    const groups = new Map();
    for (const grant of relevant) {
      const key = `${grant.grantee}\x1f${grant.grantable}`;
      const privileges = groups.get(key) ?? [];
      privileges.push(grant.privilege.toLowerCase());
      groups.set(key, privileges);
    }
    for (const [key, privileges] of groups) {
      const [grantee, grantable] = key.split('\x1f');
      output.push(
        `alter default privileges for role ${qident(entry.owner)} ` +
        `in schema ${qident(entry.schema)} grant ` +
        `${[...new Set(privileges)].sort().join(', ')} on ${kind} ` +
        `to ${roleSql(grantee)}` +
        (grantable === 'true' ? ' with grant option;' : ';'),
      );
    }
  }
  return output;
}

function securityHardeningSql(includedFunctions) {
  const output = [
    'revoke all on schema atlas from PUBLIC, anon, authenticated;',
    'grant usage on schema atlas to service_role;',
    'grant select on table atlas.v_bridge_operational_status to service_role;',
    'revoke select on table public.v_bridge_operational_status from PUBLIC, anon, authenticated;',
    'grant select on table public.v_bridge_operational_status to service_role;',
  ];
  for (const schema of ['atlas', 'public', 'private']) {
    output.push(
      `alter default privileges for role postgres in schema ${schema} revoke execute on functions from PUBLIC, anon, authenticated;`,
      `alter default privileges for role postgres in schema ${schema} grant execute on functions to service_role;`,
      `alter default privileges for role postgres in schema ${schema} revoke all on tables from PUBLIC, anon, authenticated;`,
      `alter default privileges for role postgres in schema ${schema} grant select, insert, update, delete, truncate, references, trigger on tables to service_role;`,
      `alter default privileges for role postgres in schema ${schema} revoke all on sequences from PUBLIC, anon, authenticated;`,
      `alter default privileges for role postgres in schema ${schema} grant usage, select, update on sequences to service_role;`,
    );
  }

  const includedByKey = new Map(
    includedFunctions.map((fn) => [functionKey(fn), fn]),
  );
  for (const signature of SERVICE_ONLY_FUNCTIONS) {
    const fn = includedByKey.get(signature);
    if (!fn) throw new Error(`service-only function missing: ${signature}`);
    output.push(
      `revoke all on function ${functionSignature(fn)} from PUBLIC, anon, authenticated;`,
      `grant execute on function ${functionSignature(fn)} to service_role;`,
    );
  }
  return output;
}

function buildBaseline(catalog, ledger) {
  const output = [];
  const section = (title) => output.push('', `-- ---- ${title} ----`);

  output.push(
    '-- Atlas current production-derived schema baseline.',
    '-- Production project: bjdjjgnkhxblnpdrjqtw (PostgreSQL 17.6).',
    '-- Catalog captured read-only on 2026-08-30.',
    '-- No production rows, bridge secrets, cron jobs, or runtime response rows are included.',
    '-- This is a transparent current-state squash, not a claim about lost pre-ledger history.',
    `-- Production ledger receipt: ${ledger.orderedLedgerSha256}.`,
    `-- Intentional exclusions: ${RETIRED_FUNCTIONS.size} retired/unsupported functions and ${RETIRED_TRIGGERS.size} retired triggers.`,
    `-- Intentional hardening: direct Atlas namespace access and ${SERVICE_ONLY_FUNCTIONS.length} sensitive functions are service-role-only.`,
    '',
    'set check_function_bodies = false;',
  );

  section('extensions and schemas');
  output.push(
    'create schema if not exists extensions;',
    'create schema if not exists atlas;',
    'create schema if not exists private;',
    'create schema if not exists vault;',
  );
  for (const extension of catalog.extensions) {
    if (extension.name === 'plpgsql') continue;
    output.push(
      `create extension if not exists ${qident(extension.name)} with schema ` +
      `${qident(extension.schema)};`,
    );
  }
  output.push('set search_path = pg_catalog, public, extensions;');

  if (catalog.types.length !== 0) {
    throw new Error('custom standalone types require explicit generator support');
  }

  const identityColumns = new Set();
  for (const table of catalog.tables) {
    for (const column of table.columns) {
      if (column.identity) {
        identityColumns.add(`${table.schema}.${table.name}.${column.name}`);
      }
    }
  }

  section('standalone sequences');
  for (const sequence of catalog.sequences) {
    if (sequence.owned_by && identityColumns.has(sequence.owned_by)) continue;
    output.push(
      `create sequence ${qname(sequence.schema, sequence.name)} ` +
      `as ${sequence.data_type} increment by ${sequence.increment_by} ` +
      `start with ${sequence.start_value} cache ${sequence.cache_size}` +
      (sequence.cycle ? ' cycle;' : ' no cycle;'),
    );
  }

  section('tables');
  for (const table of catalog.tables.sort((a, b) =>
    `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`)
  )) {
    const columns = table.columns.map((column) => {
      let definition = `  ${qident(column.name)} ${column.type}`;
      if (column.collation) {
        definition += ` collate ${qname(column.collation_schema, column.collation)}`;
      }
      if (column.identity) {
        definition += column.identity === 'a'
          ? ' generated always as identity'
          : ' generated by default as identity';
      } else if (column.generated) {
        definition += ` generated always as (${column.default}) stored`;
      } else if (column.default !== null) {
        definition += ` default ${column.default}`;
      }
      if (column.not_null) definition += ' not null';
      return definition;
    });
    output.push(
      `create table ${qname(table.schema, table.name)} (\n` +
      columns.join(',\n') +
      '\n);',
    );
  }

  section('non-foreign-key constraints');
  for (const table of catalog.tables) {
    for (const constraint of table.constraints) {
      if (constraint.type === 'f') continue;
      output.push(
        `alter table only ${qname(table.schema, table.name)} add constraint ` +
        `${qident(constraint.name)} ${constraint.definition}` +
        (constraint.validated ? ';' : ' not valid;'),
      );
    }
  }

  section('foreign keys');
  for (const table of catalog.tables) {
    for (const constraint of table.constraints) {
      if (constraint.type !== 'f') continue;
      output.push(
        `alter table only ${qname(table.schema, table.name)} add constraint ` +
        `${qident(constraint.name)} ${constraint.definition}` +
        (constraint.validated ? ';' : ' not valid;'),
      );
    }
  }

  section('sequence ownership');
  for (const sequence of catalog.sequences) {
    if (!sequence.owned_by || identityColumns.has(sequence.owned_by)) continue;
    output.push(
      `alter sequence ${qname(sequence.schema, sequence.name)} owned by ` +
      sequence.owned_by.split('.').map(qident).join('.') + ';',
    );
  }

  section('indexes');
  for (const table of catalog.tables) {
    const constraintIndexes = new Set(
      table.constraints
        .filter((constraint) => ['p', 'u', 'x'].includes(constraint.type))
        .map((constraint) => constraint.name),
    );
    for (const index of table.indexes) {
      if (constraintIndexes.has(index.name)) continue;
      output.push(endStatement(index.definition));
    }
  }

  section('functions');
  const includedFunctions = catalog.functions
    .filter((fn) => !RETIRED_FUNCTIONS.has(functionKey(fn)))
    .sort((a, b) => functionKey(a).localeCompare(functionKey(b)));
  for (const fn of includedFunctions) {
    output.push(endStatement(fn.definition));
  }

  section('views');
  for (const view of topologicalViews(catalog.views)) {
    const options = view.reloptions?.length
      ? ` with (${view.reloptions.join(', ')})`
      : '';
    const columns = view.columns.length
      ? ' (' + view.columns.map(qident).join(', ') + ')'
      : '';
    output.push(
      `create view ${qname(view.schema, view.name)}${columns}${options} as\n` +
      endStatement(view.definition),
    );
  }

  section('row-level security and policies');
  for (const table of catalog.tables) {
    const name = qname(table.schema, table.name);
    if (table.rls_enabled) output.push(`alter table ${name} enable row level security;`);
    if (table.rls_forced) output.push(`alter table ${name} force row level security;`);
    for (const policy of table.policies) {
      const roles = policy.roles.map((role) =>
        role.toLowerCase() === 'public' ? 'PUBLIC' : qident(role)
      ).join(', ');
      let sql =
        `create policy ${qident(policy.name)} on ${name} ` +
        `as ${policy.permissive.toLowerCase()} for ${policy.command.toLowerCase()} ` +
        `to ${roles}`;
      if (policy.using) sql += ` using (${policy.using})`;
      if (policy.check) sql += ` with check (${policy.check})`;
      output.push(sql + ';');
    }
  }

  section('triggers');
  const includedTriggers = catalog.triggers.filter((trigger) =>
    !RETIRED_TRIGGERS.has(
      `${trigger.schema}.${trigger.table}.${trigger.trigger_name}`,
    )
  );
  for (const trigger of includedTriggers) {
    output.push(endStatement(trigger.definition));
    const tableName = qname(trigger.schema, trigger.table);
    const triggerName = qident(trigger.trigger_name);
    if (trigger.enabled === 'D') {
      output.push(`alter table ${tableName} disable trigger ${triggerName};`);
    } else if (trigger.enabled === 'A') {
      output.push(`alter table ${tableName} enable always trigger ${triggerName};`);
    } else if (trigger.enabled === 'R') {
      output.push(`alter table ${tableName} enable replica trigger ${triggerName};`);
    }
  }

  section('comments');
  for (const table of catalog.tables) {
    if (table.comment !== null) {
      output.push(
        `comment on table ${qname(table.schema, table.name)} is ` +
        `${qliteral(table.comment)};`,
      );
    }
    for (const column of table.columns) {
      if (column.comment === null) continue;
      output.push(
        `comment on column ${qname(table.schema, table.name)}.` +
        `${qident(column.name)} is ${qliteral(column.comment)};`,
      );
    }
  }
  for (const sequence of catalog.sequences) {
    if (sequence.comment !== null) {
      output.push(
        `comment on sequence ${qname(sequence.schema, sequence.name)} is ` +
        `${qliteral(sequence.comment)};`,
      );
    }
  }
  for (const fn of includedFunctions) {
    if (fn.comment !== null) {
      output.push(
        `comment on function ${functionSignature(fn)} is ` +
        `${qliteral(fn.comment)};`,
      );
    }
  }
  for (const view of catalog.views) {
    if (view.comment !== null) {
      output.push(
        `comment on view ${qname(view.schema, view.name)} is ` +
        `${qliteral(view.comment)};`,
      );
    }
  }
  for (const trigger of includedTriggers) {
    if (trigger.comment !== null) {
      output.push(
        `comment on trigger ${qident(trigger.trigger_name)} on ` +
        `${qname(trigger.schema, trigger.table)} is ` +
        `${qliteral(trigger.comment)};`,
      );
    }
  }

  section('object privileges');
  for (const sequence of catalog.sequences) {
    output.push(...objectGrantSql(
      'sequence',
      qname(sequence.schema, sequence.name),
      sequence.owner,
      sequence.grants,
    ));
  }
  for (const table of catalog.tables) {
    output.push(...objectGrantSql(
      'table',
      qname(table.schema, table.name),
      table.owner,
      table.grants,
    ));
  }
  for (const view of catalog.views) {
    output.push(...objectGrantSql(
      'table',
      qname(view.schema, view.name),
      view.owner,
      view.grants,
    ));
  }
  for (const fn of includedFunctions) {
    output.push(...objectGrantSql(
      'function',
      functionSignature(fn),
      fn.owner,
      fn.grants,
    ));
  }

  section('schema and default privileges');
  for (const schema of catalog.schemaState.schemas) {
    output.push(...objectGrantSql(
      'schema',
      qident(schema.name),
      schema.owner,
      schema.grants,
    ));
    if (schema.comment !== null) {
      output.push(
        `comment on schema ${qident(schema.name)} is ${qliteral(schema.comment)};`,
      );
    }
  }
  output.push(...defaultAclSql(catalog.schemaState));

  section('realtime publication membership');
  for (const member of catalog.publicationState.members) {
    output.push(
      'do $publication$ begin ' +
      `if not exists (select 1 from pg_publication where pubname=${qliteral(member.publication)}) ` +
      `then raise exception ${qliteral(`required publication ${member.publication} is missing`)}; ` +
      'end if; if not exists (select 1 from pg_publication_tables ' +
      `where pubname=${qliteral(member.publication)} and schemaname=${qliteral(member.schema)} ` +
      `and tablename=${qliteral(member.table)}) then execute ` +
      `${qliteral(
        `alter publication ${qident(member.publication)} add table ` +
        qname(member.schema, member.table),
      )}; end if; end $publication$;`,
    );
  }

  section('intentional security hardening');
  output.push(...securityHardeningSql(includedFunctions));

  output.push('', 'reset search_path;', 'reset check_function_bodies;', '');
  return qualifyExtensionCalls(
    output.join('\n').replace(/[ \t]+$/gm, ''),
  );
}

function receiptMigration(row) {
  return [
    '-- Atlas historical production-ledger compatibility receipt.',
    `-- Version: ${row.version}`,
    `-- Name: ${row.name}`,
    `-- Original statements SHA-256: ${row.statementsSha256}`,
    `-- Original rollback SHA-256: ${row.rollbackSha256}`,
    '-- Disposition: represented by the current production-derived baseline.',
    '-- This no-op preserves exact production version/name order without claiming',
    '-- that the incomplete overlay was a self-contained founding migration.',
    '',
    'do $atlas_ledger_receipt$',
    'begin',
    '  null;',
    'end',
    '$atlas_ledger_receipt$;',
    '',
  ].join('\n');
}

function forwardRepairMigration(catalog) {
  const functionsByKey = new Map(
    catalog.functions.map((fn) => [functionKey(fn), fn]),
  );
  const includedFunctions = catalog.functions.filter(
    (fn) => !RETIRED_FUNCTIONS.has(functionKey(fn)),
  );
  const output = [
    '-- Atlas forward operational rebuild repair.',
    '-- This is the only migration in this candidate that is not already present',
    '-- in the 49-row production ledger. It remains unmerged and unapplied to',
    '-- production until isolated replay, preview parity, advisors, and review pass.',
    '',
    'set search_path = pg_catalog, public, extensions;',
    '',
    '-- Remove captured triggers that invoke retired or invalid cross-service writers.',
    'drop trigger if exists trg_bridge_action on atlas.action_queue;',
    'drop trigger if exists trg_bridge_emit_signal_v1 on atlas.civic_map_signals;',
    'drop trigger if exists trg_queue_bridge_v3 on atlas.civic_map_signals;',
    'drop trigger if exists trg_bridge_entity on atlas.entity_registry;',
    '',
    '-- Remove the retired/invalid functions without CASCADE; undeclared dependencies fail closed.',
  ];
  for (const key of [...RETIRED_FUNCTIONS].sort()) {
    const fn = functionsByKey.get(key);
    if (!fn) throw new Error(`retired function missing from catalog: ${key}`);
    output.push(`drop function if exists ${functionSignature(fn)};`);
  }
  output.push(
    '',
    '-- Apply reviewed namespace, RPC, operational-view, and future-object hardening.',
    ...securityHardeningSql(includedFunctions),
    '',
    'reset search_path;',
    '',
  );
  return output.join('\n').replace(/[ \t]+$/gm, '');
}

function syncBoundaryManifest(reconstruction) {
  const manifest = JSON.parse(readFileSync(boundaryManifestPath, 'utf8'));
  manifest.canonical.status = 'candidate';
  manifest.canonical.migrations = reconstruction.migrations;
  manifest.productionEvidence.ledgerReconciliationStatus =
    'reconstructed_pending_preview_parity';
  manifest.productionEvidence.currentProductionCatalog = {
    evidenceRoot: 'supabase/evidence/current-production-catalog',
    reconstructionManifestPath:
      'supabase/evidence/current-production-catalog/reconstruction-manifest.json',
    reconstructionManifestSha256: sha256(readFileSync(reconstructionPath)),
    catalogRootSha256: reconstruction.catalogRootSha256,
    counts: reconstruction.catalogCounts,
    componentFingerprintsSha256: PRODUCTION_COMPONENT_FINGERPRINTS,
    productionBoundary: 'read_only',
    model: 'current_production_derived_schema_squash',
  };
  manifest.foundationalDependencyClosure.status =
    'represented_in_current_state_baseline_pending_fresh_pg17_replay';

  const dispositions = {
    production_schema_baseline_missing: {
      status: 'resolved',
      disposition:
        'A complete read-only catalog capture now generates the current production-derived baseline.',
    },
    production_ledger_contains_transient_payload_execution: {
      status: 'resolved',
      disposition:
        'The current-state baseline contains no hard-coded pg_net response-row payload execution; the original rows remain hash-receipted evidence only.',
    },
    pg_net_foundation_not_represented: {
      status: 'resolved',
      disposition:
        'The baseline creates pg_net without a version pin before dependent functions.',
    },
    production_ledger_not_replayable_from_empty: {
      status: 'candidate_pending_preview_replay',
      disposition:
        'The baseline plus 48 historical receipts and one pending forward repair forms a 50-version candidate chain; empty PG17 and hosted preview replay are still required.',
    },
    historical_atlas_schema_shapes_unknown: {
      status: 'accepted_current_state_squash_pending_replay',
      disposition:
        'Lost pre-ledger history is not fabricated; the candidate explicitly adopts the verified current catalog as a squash.',
    },
    civic_infrastructure_policy_history_unknown: {
      status: 'accepted_current_state_squash_pending_replay',
      disposition:
        'Lost policy history is not fabricated; current verified RLS, policies, grants, and comments are represented.',
    },
    retired_cross_service_writers_must_stay_retired: {
      status: 'resolved',
      disposition:
        `${RETIRED_FUNCTIONS.size} retired or invalid runtime functions and ${RETIRED_TRIGGERS.size} bridge triggers are deliberately excluded from the baseline and removed by the forward repair.`,
    },
    lighthouse_rpc_access_decision_pending: {
      status: 'resolved',
      disposition:
        'The conservative candidate revokes anonymous/authenticated execution and grants the two export RPCs only to service_role.',
    },
    security_acceptance_pending: {
      status: 'open',
      disposition:
        'Awaiting fresh PG17 replay, hosted preview parity, pgTAP, lint, and fresh advisors.',
    },
  };
  for (const blocker of manifest.blockers) {
    const disposition = dispositions[blocker.id];
    if (disposition) Object.assign(blocker, disposition);
  }
  manifest.prohibitedCanonicalDependencies = [
    'hard-coded net._http_response response-row payload execution',
    'server-side file reads',
    'COPY PROGRAM',
    'psql runtime includes',
  ];
  writeFileSync(
    boundaryManifestPath,
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

function main() {
  const catalog = loadCatalog();
  const ledger = readJson(
    'supabase/evidence/production-migration-ledger.json',
  );
  if (ledger.rows.length !== 49) {
    throw new Error(`expected 49 production ledger rows, got ${ledger.rows.length}`);
  }

  mkdirSync(migrationRoot, { recursive: true });
  for (const file of readdirSync(migrationRoot)) {
    if (file.endsWith('.sql')) unlinkSync(path.join(migrationRoot, file));
  }

  const migrations = [];
  for (const [index, row] of ledger.rows.entries()) {
    const fileName = `${row.version}_${row.name}.sql`;
    const sql = index === 0
      ? buildBaseline(catalog, ledger)
      : receiptMigration(row);
    writeFileSync(path.join(migrationRoot, fileName), sql);
    migrations.push({
      path: `supabase/migrations/${fileName}`,
      version: row.version,
      name: row.name,
      kind: index === 0
        ? 'production_baseline'
        : 'production_ledger_receipt',
      sha256: sha256(sql),
      productionStatementsSha256: row.statementsSha256,
      productionRollbackSha256: row.rollbackSha256,
      reconciliationDisposition: index === 0
        ? 'current_production_schema_squash_at_existing_first_version'
        : 'historical_overlay_superseded_by_current_baseline',
    });
  }
  const forwardFileName =
    `${FORWARD_REPAIR_VERSION}_${FORWARD_REPAIR_NAME}.sql`;
  const forwardSql = forwardRepairMigration(catalog);
  writeFileSync(path.join(migrationRoot, forwardFileName), forwardSql);
  migrations.push({
    path: `supabase/migrations/${forwardFileName}`,
    version: FORWARD_REPAIR_VERSION,
    name: FORWARD_REPAIR_NAME,
    kind: 'forward_repair',
    sha256: sha256(forwardSql),
    reconciliationDisposition:
      'pending_production_forward_repair_after_preview_acceptance',
  });

  const evidenceFiles = readdirSync(evidenceRoot)
    .filter((file) => file.endsWith('.json') && file !== path.basename(reconstructionPath))
    .sort()
    .map((file) => {
      const bytes = readFileSync(path.join(evidenceRoot, file));
      return {
        path: `supabase/evidence/current-production-catalog/${file}`,
        bytes: bytes.length,
        sha256: sha256(bytes),
      };
    });
  const catalogRootHash = sha256(
    evidenceFiles
      .map((file) => `${file.path}\x1f${file.bytes}\x1f${file.sha256}`)
      .join('\x1e'),
  );

  const reconstruction = {
    schemaVersion: 1,
    evidenceKind: 'Atlas current production-derived baseline reconstruction',
    projectRef: 'bjdjjgnkhxblnpdrjqtw',
    serverVersion: '17.6',
    capturedAt: '2026-08-30T20:40:00Z',
    productionBoundary: 'read_only',
    productionLedgerOrderedSha256: ledger.orderedLedgerSha256,
    catalogRootSha256: catalogRootHash,
    catalogCounts: {
      schemas: 3,
      relations: catalog.tables.length + catalog.views.length + catalog.sequences.length,
      tables: catalog.tables.length,
      views: catalog.views.length,
      columns: catalog.tables.reduce(
        (sum, table) => sum + table.columns.length,
        0,
      ) + catalog.views.reduce(
        (sum, view) => sum + view.columns.length,
        0,
      ),
      functionsObserved: catalog.functions.length,
      functionsIncluded: catalog.functions.length - RETIRED_FUNCTIONS.size,
      sequences: catalog.sequences.length,
      triggersObserved: catalog.triggers.length,
      triggersIncluded: catalog.triggers.length - RETIRED_TRIGGERS.size,
      policies: catalog.tables.reduce(
        (sum, table) => sum + table.policies.length,
        0,
      ),
      constraints: catalog.tables.reduce(
        (sum, table) => sum + table.constraints.length,
        0,
      ),
      indexes: catalog.tables.reduce(
        (sum, table) => sum + table.indexes.length,
        0,
      ),
      comments: catalog.tables.reduce(
        (sum, table) => sum + Number(typeof table.comment === 'string') +
          table.columns.filter((column) => typeof column.comment === 'string').length +
          table.constraints.filter((constraint) => typeof constraint.comment === 'string').length +
          table.indexes.filter((index) => typeof index.comment === 'string').length,
        0,
      ) + catalog.views.filter((view) => typeof view.comment === 'string').length +
        catalog.functions.filter((fn) => typeof fn.comment === 'string').length +
        catalog.sequences.filter((sequence) => typeof sequence.comment === 'string').length +
        catalog.schemaState.schemas.filter((schema) => typeof schema.comment === 'string').length,
    },
    productionComponentFingerprintsSha256: PRODUCTION_COMPONENT_FINGERPRINTS,
    sourceEvidence: evidenceFiles,
    intentionalExclusions: {
      functions: [...RETIRED_FUNCTIONS].sort(),
      triggers: [...RETIRED_TRIGGERS].sort(),
      rowData: 'all production rows, including bridge_config secrets and allowlist rows',
      cronJobs: 'none observed; no scheduler state exported',
    },
    intentionalSecurityHardening: {
      atlasSchema: 'direct namespace usage is service_role only',
      functions: SERVICE_ONLY_FUNCTIONS,
      futureObjectDefaults:
        'postgres-owned objects in atlas/public/private default to service_role only',
      operationalView:
        'public.v_bridge_operational_status and its Atlas dependency are service_role only',
      preservedCurrentPublicSurfaces:
        'existing table/view grants and RLS policies are retained unless explicitly listed above',
    },
    platformOwnedStateExcluded: {
      defaultPrivileges: [
        'supabase_admin in public (managed by the Supabase platform and not replayable by hosted postgres)',
      ],
    },
    migrations,
  };
  writeFileSync(
    reconstructionPath,
    JSON.stringify(reconstruction, null, 2) + '\n',
  );
  syncBoundaryManifest(reconstruction);

  console.log(JSON.stringify({
    catalogRootSha256: catalogRootHash,
    migrationCount: migrations.length,
    baselineBytes: readFileSync(
      path.join(migrationRoot, path.basename(migrations[0].path)),
    ).length,
    catalogCounts: reconstruction.catalogCounts,
  }, null, 2));
}

if (!existsSync(evidenceRoot)) {
  throw new Error(`missing evidence root: ${evidenceRoot}`);
}
main();

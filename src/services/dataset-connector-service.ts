/**
 * Dataset Connector Service
 * 
 * Bridges public dataset tables (consumer_complaints, campaign_finance_records,
 * enforcement_records, policy_change_registry) to system engines:
 * - Signal Engine: generates signals from complaints and enforcement actions
 * - Pattern Registry: identifies repeat offenders, regulatory gaps
 * - Trend & Pressure Engine: tracks complaint growth, enforcement frequency
 * - Strategy Engine: intervention targeting from enforcement data
 * - Reform Package Engine: legislative change proposals from policy registry
 * 
 * Also provides scheduled ingestion job management and dataset statistics.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ============================================================
// Types
// ============================================================
export interface DatasetStats {
  datasetId: string;
  datasetName: string;
  source: string;
  jurisdiction: string;
  domain: string;
  recordCount: number;
  lastIngested: number | null;
  enabled: boolean;
  updateFrequency: string;
}

export interface IngestionJobConfig {
  datasetId: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  cronExpression: string;
  enabled: boolean;
}

export interface SignalFromDataset {
  signalType: string;
  source: string;
  entity: string;
  jurisdiction: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  dataPoints: number;
  claimType: string;
}

export interface PatternFromDataset {
  patternType: string;
  entity: string;
  jurisdiction: string;
  occurrences: number;
  domain: string;
  description: string;
}

export interface TrendFromDataset {
  metric: string;
  jurisdiction: string;
  domain: string;
  currentValue: number;
  previousValue: number;
  changePercent: number;
  direction: 'increasing' | 'decreasing' | 'stable';
  period: string;
}

// ============================================================
// Dataset Registry Operations
// ============================================================

export async function listDatasets(): Promise<DatasetStats[]> {
  const [rows]: any = await db.execute(sql.raw(
    `SELECT stream_id_dsr as datasetId, stream_name_dsr as datasetName, source_dsr as source, jurisdiction_dsr as jurisdiction, domain_dsr as domain, 
            records_ingested_dsr as recordCount, last_ingested_at_dsr as lastIngested,
            enabled_dsr as enabled, update_freq_dsr as updateFrequency
     FROM data_stream_registry ORDER BY stream_name_dsr`
  ));
  return (rows as any[]).map(r => ({
    datasetId: r.datasetId,
    datasetName: r.datasetName,
    source: r.source,
    jurisdiction: r.jurisdiction,
    domain: r.domain,
    recordCount: Number(r.recordCount) || 0,
    lastIngested: r.lastIngested ? Number(r.lastIngested) : null,
    enabled: Boolean(r.enabled),
    updateFrequency: r.updateFrequency,
  }));
}

export async function getDatasetById(datasetId: string): Promise<DatasetStats | null> {
  const [rows]: any = await db.execute(sql.raw(
    `SELECT stream_id_dsr as datasetId, stream_name_dsr as datasetName, source_dsr as source, jurisdiction_dsr as jurisdiction, domain_dsr as domain,
            records_ingested_dsr as recordCount, last_ingested_at_dsr as lastIngested,
            enabled_dsr as enabled, update_freq_dsr as updateFrequency
     FROM data_stream_registry WHERE stream_id_dsr = '${datasetId.replace(/'/g, "''")}'`
  ));
  if (!(rows as any[]).length) return null;
  const r = (rows as any[])[0];
  return {
    datasetId: r.datasetId,
    datasetName: r.datasetName,
    source: r.source,
    jurisdiction: r.jurisdiction,
    domain: r.domain,
    recordCount: Number(r.recordCount) || 0,
    lastIngested: r.lastIngested ? Number(r.lastIngested) : null,
    enabled: Boolean(r.enabled),
    updateFrequency: r.updateFrequency,
  };
}

export async function getDatasetSummary(): Promise<{
  totalDatasets: number;
  enabledDatasets: number;
  totalRecords: number;
  byDomain: Record<string, number>;
  byJurisdiction: Record<string, number>;
}> {
  const [rows]: any = await db.execute(sql.raw(
    `SELECT domain_dsr as domain, jurisdiction_dsr as jurisdiction, COUNT(*) as cnt, SUM(records_ingested_dsr) as total, SUM(enabled_dsr) as enabled
     FROM data_stream_registry GROUP BY domain_dsr, jurisdiction_dsr`
  ));
  const byDomain: Record<string, number> = {};
  const byJurisdiction: Record<string, number> = {};
  let totalDatasets = 0;
  let enabledDatasets = 0;
  let totalRecords = 0;
  for (const r of rows as any[]) {
    const d = r.domain || 'unknown';
    const j = r.jurisdiction || 'unknown';
    byDomain[d] = (byDomain[d] || 0) + Number(r.cnt);
    byJurisdiction[j] = (byJurisdiction[j] || 0) + Number(r.cnt);
    totalDatasets += Number(r.cnt);
    enabledDatasets += Number(r.enabled);
    totalRecords += Number(r.total) || 0;
  }
  return { totalDatasets, enabledDatasets, totalRecords, byDomain, byJurisdiction };
}

// ============================================================
// Signal Engine Connection — Consumer Complaints
// ============================================================

export async function extractSignalsFromComplaints(
  jurisdiction?: string,
  limit: number = 50
): Promise<SignalFromDataset[]> {
  const whereClause = jurisdiction
    ? `WHERE jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`
    : '';
  
  // Detect high-frequency complaint patterns by company
  const [companySignals]: any = await db.execute(sql.raw(
    `SELECT company_name, claim_type, jurisdiction, COUNT(*) as cnt,
            SUM(CASE WHEN consumer_disputed = 1 THEN 1 ELSE 0 END) as disputed
     FROM consumer_complaints ${whereClause}
     GROUP BY company_name, claim_type, jurisdiction
     HAVING cnt >= 3
     ORDER BY cnt DESC
     LIMIT ${limit}`
  ));

  return (companySignals as any[]).map(r => {
    const cnt = Number(r.cnt);
    const disputed = Number(r.disputed);
    const severity = cnt >= 20 ? 'critical' : cnt >= 10 ? 'high' : cnt >= 5 ? 'medium' : 'low';
    return {
      signalType: 'complaint_cluster',
      source: 'consumer_complaints',
      entity: r.company_name,
      jurisdiction: r.jurisdiction,
      severity,
      description: `${cnt} complaints against ${r.company_name} (${disputed} disputed) for ${r.claim_type}`,
      dataPoints: cnt,
      claimType: r.claim_type || 'consumer_protection',
    };
  });
}

// ============================================================
// Signal Engine Connection — Enforcement Records
// ============================================================

export async function extractSignalsFromEnforcement(
  jurisdiction?: string,
  limit: number = 50
): Promise<SignalFromDataset[]> {
  const whereClause = jurisdiction
    ? `WHERE jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`
    : '';

  const [enfSignals]: any = await db.execute(sql.raw(
    `SELECT respondent_name, violation_type, agency_name, jurisdiction, 
            COUNT(*) as cnt, SUM(penalty_amount) as totalPenalty
     FROM enforcement_records ${whereClause}
     GROUP BY respondent_name, violation_type, agency_name, jurisdiction
     HAVING cnt >= 2
     ORDER BY cnt DESC
     LIMIT ${limit}`
  ));

  return (enfSignals as any[]).map(r => {
    const cnt = Number(r.cnt);
    const penalty = Number(r.totalPenalty) || 0;
    const severity = cnt >= 5 ? 'critical' : cnt >= 3 ? 'high' : 'medium';
    return {
      signalType: 'enforcement_cluster',
      source: 'enforcement_records',
      entity: r.respondent_name,
      jurisdiction: r.jurisdiction,
      severity,
      description: `${cnt} enforcement actions against ${r.respondent_name} by ${r.agency_name} ($${penalty.toLocaleString()} in penalties)`,
      dataPoints: cnt,
      claimType: r.violation_type?.toLowerCase().replace(/ /g, '_') || 'enforcement',
    };
  });
}

// ============================================================
// Pattern Registry Connection — Repeat Offenders
// ============================================================

export async function detectRepeatOffenders(
  minOccurrences: number = 3,
  limit: number = 30
): Promise<PatternFromDataset[]> {
  // Cross-reference complaints and enforcement for repeat offenders
  const [patterns]: any = await db.execute(sql.raw(
    `SELECT entity, jurisdiction, domain, SUM(cnt) as total, GROUP_CONCAT(source) as sources
     FROM (
       SELECT company_name as entity, jurisdiction, claim_type as domain, COUNT(*) as cnt, 'complaints' as source
       FROM consumer_complaints GROUP BY company_name, jurisdiction, claim_type
       UNION ALL
       SELECT respondent_name as entity, jurisdiction, violation_type as domain, COUNT(*) as cnt, 'enforcement' as source
       FROM enforcement_records GROUP BY respondent_name, jurisdiction, violation_type
     ) combined
     GROUP BY entity, jurisdiction, domain
     HAVING total >= ${minOccurrences}
     ORDER BY total DESC
     LIMIT ${limit}`
  ));

  return (patterns as any[]).map(r => ({
    patternType: 'repeat_offender',
    entity: r.entity,
    jurisdiction: r.jurisdiction,
    occurrences: Number(r.total),
    domain: r.domain || 'unknown',
    description: `${r.entity} has ${r.total} combined complaints/enforcement actions across ${r.sources}`,
  }));
}

// ============================================================
// Pattern Registry — Regulatory Gaps
// ============================================================

export async function detectRegulatoryGaps(limit: number = 20): Promise<PatternFromDataset[]> {
  // Find jurisdictions with high complaints but low enforcement
  const [gaps]: any = await db.execute(sql.raw(
    `SELECT c.jurisdiction, c.claim_type as domain, c.complaint_count, COALESCE(e.enforcement_count, 0) as enforcement_count,
            c.complaint_count - COALESCE(e.enforcement_count, 0) as gap
     FROM (
       SELECT jurisdiction, claim_type, COUNT(*) as complaint_count
       FROM consumer_complaints GROUP BY jurisdiction, claim_type
     ) c
     LEFT JOIN (
       SELECT jurisdiction, claim_type, COUNT(*) as enforcement_count
       FROM enforcement_records GROUP BY jurisdiction, claim_type
     ) e ON c.jurisdiction = e.jurisdiction AND c.claim_type = e.claim_type
     WHERE c.complaint_count > 5
     ORDER BY gap DESC
     LIMIT ${limit}`
  ));

  return (gaps as any[]).map(r => ({
    patternType: 'regulatory_gap',
    entity: `${r.jurisdiction} - ${r.domain}`,
    jurisdiction: r.jurisdiction,
    occurrences: Number(r.gap),
    domain: r.domain || 'unknown',
    description: `${r.complaint_count} complaints vs ${r.enforcement_count} enforcement actions in ${r.jurisdiction} for ${r.domain} — potential enforcement gap`,
  }));
}

// ============================================================
// Trend & Pressure Engine — Complaint Growth
// ============================================================

export async function analyzeComplaintTrends(
  jurisdiction?: string
): Promise<TrendFromDataset[]> {
  const whereClause = jurisdiction
    ? `WHERE jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`
    : '';

  const [trends]: any = await db.execute(sql.raw(
    `SELECT jurisdiction, claim_type as domain,
            SUM(CASE WHEN date_received >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) THEN 1 ELSE 0 END) as recent,
            SUM(CASE WHEN date_received < DATE_SUB(CURDATE(), INTERVAL 6 MONTH) THEN 1 ELSE 0 END) as older,
            COUNT(*) as total
     FROM consumer_complaints ${whereClause}
     GROUP BY jurisdiction, claim_type
     HAVING total >= 5
     ORDER BY total DESC`
  ));

  return (trends as any[]).map(r => {
    const recent = Number(r.recent);
    const older = Number(r.older) || 1;
    const changePercent = ((recent - older) / older) * 100;
    return {
      metric: 'complaint_volume',
      jurisdiction: r.jurisdiction,
      domain: r.domain || 'unknown',
      currentValue: recent,
      previousValue: older,
      changePercent: Math.round(changePercent * 10) / 10,
      direction: changePercent > 10 ? 'increasing' : changePercent < -10 ? 'decreasing' : 'stable',
      period: 'last_6_months_vs_prior',
    };
  });
}

// ============================================================
// Trend & Pressure — Enforcement Frequency
// ============================================================

export async function analyzeEnforcementTrends(
  jurisdiction?: string
): Promise<TrendFromDataset[]> {
  const whereClause = jurisdiction
    ? `WHERE jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`
    : '';

  const [trends]: any = await db.execute(sql.raw(
    `SELECT jurisdiction, violation_type as domain, agency_name,
            SUM(CASE WHEN action_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) THEN 1 ELSE 0 END) as recent,
            SUM(CASE WHEN action_date < DATE_SUB(CURDATE(), INTERVAL 6 MONTH) THEN 1 ELSE 0 END) as older,
            COUNT(*) as total,
            SUM(penalty_amount) as totalPenalty
     FROM enforcement_records ${whereClause}
     GROUP BY jurisdiction, violation_type, agency_name
     HAVING total >= 3
     ORDER BY total DESC`
  ));

  return (trends as any[]).map(r => {
    const recent = Number(r.recent);
    const older = Number(r.older) || 1;
    const changePercent = ((recent - older) / older) * 100;
    return {
      metric: 'enforcement_frequency',
      jurisdiction: r.jurisdiction,
      domain: r.domain || 'unknown',
      currentValue: recent,
      previousValue: older,
      changePercent: Math.round(changePercent * 10) / 10,
      direction: changePercent > 10 ? 'increasing' : changePercent < -10 ? 'decreasing' : 'stable',
      period: 'last_6_months_vs_prior',
    };
  });
}

// ============================================================
// Strategy Engine — Intervention Targeting
// ============================================================

export async function generateInterventionTargets(
  jurisdiction?: string,
  limit: number = 20
): Promise<Array<{
  entity: string;
  jurisdiction: string;
  complaintCount: number;
  enforcementCount: number;
  totalPenalties: number;
  recommendedAction: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}>> {
  const whereClause = jurisdiction
    ? `AND jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`
    : '';

  const [targets]: any = await db.execute(sql.raw(
    `SELECT entity, jurisdiction, complaints, enforcements, penalties,
            complaints + enforcements as total
     FROM (
       SELECT company_name as entity, jurisdiction, COUNT(*) as complaints, 0 as enforcements, 0 as penalties
       FROM consumer_complaints WHERE 1=1 ${whereClause}
       GROUP BY company_name, jurisdiction
       UNION ALL
       SELECT respondent_name as entity, jurisdiction, 0 as complaints, COUNT(*) as enforcements, SUM(penalty_amount) as penalties
       FROM enforcement_records WHERE 1=1 ${whereClause}
       GROUP BY respondent_name, jurisdiction
     ) combined
     GROUP BY entity, jurisdiction
     ORDER BY total DESC
     LIMIT ${limit}`
  ));

  return (targets as any[]).map(r => {
    const complaints = Number(r.complaints);
    const enforcements = Number(r.enforcements);
    const penalties = Number(r.penalties) || 0;
    const total = complaints + enforcements;
    const priority = total >= 10 ? 'critical' : total >= 5 ? 'high' : total >= 3 ? 'medium' : 'low';
    const recommendedAction = enforcements > 0
      ? 'Monitor ongoing enforcement; consider advocacy escalation'
      : complaints >= 5
        ? 'File formal complaint with regulatory agency'
        : 'Document pattern; prepare for potential escalation';
    return {
      entity: r.entity,
      jurisdiction: r.jurisdiction,
      complaintCount: complaints,
      enforcementCount: enforcements,
      totalPenalties: penalties,
      recommendedAction,
      priority,
    };
  });
}

// ============================================================
// Reform Package Engine — Policy Change Proposals
// ============================================================

export async function getPolicyChangeProposals(
  jurisdiction?: string,
  status?: string
): Promise<Array<{
  changeId: string;
  title: string;
  reformType: string;
  jurisdiction: string;
  domain: string;
  status: string;
  priorityScore: number;
  urgencyLevel: string;
  evidenceStrength: string;
  summary: string;
}>> {
  let where = 'WHERE 1=1';
  if (jurisdiction) where += ` AND jurisdiction = '${jurisdiction.replace(/'/g, "''")}'`;
  if (status) where += ` AND status = '${status.replace(/'/g, "''")}'`;

  const [rows]: any = await db.execute(sql.raw(
    `SELECT change_id, proposal_title, reform_type, jurisdiction, harm_domain,
            status, priority_score, urgency_level, evidence_strength, proposal_summary
     FROM policy_change_registry ${where}
     ORDER BY priority_score DESC`
  ));

  return (rows as any[]).map(r => ({
    changeId: r.change_id,
    title: r.proposal_title,
    reformType: r.reform_type,
    jurisdiction: r.jurisdiction,
    domain: r.harm_domain,
    status: r.status,
    priorityScore: Number(r.priority_score),
    urgencyLevel: r.urgency_level,
    evidenceStrength: r.evidence_strength,
    summary: r.proposal_summary,
  }));
}

// ============================================================
// Campaign Finance — Political Alignment Analysis
// ============================================================

export async function analyzeCampaignFinance(
  policyDomain?: string,
  limit: number = 20
): Promise<Array<{
  candidateName: string;
  party: string;
  office: string;
  jurisdiction: string;
  totalContributions: number;
  contributorCount: number;
  policyDomain: string;
  alignmentScore: number;
}>> {
  let where = 'WHERE 1=1';
  if (policyDomain) where += ` AND policy_domain = '${policyDomain.replace(/'/g, "''")}'`;

  const [rows]: any = await db.execute(sql.raw(
    `SELECT candidate_name, party, office, jurisdiction, policy_domain,
            SUM(contribution_amount) as total, COUNT(*) as cnt
     FROM campaign_finance_records ${where}
     GROUP BY candidate_name, party, office, jurisdiction, policy_domain
     ORDER BY total DESC
     LIMIT ${limit}`
  ));

  return (rows as any[]).map(r => {
    const total = Number(r.total) || 0;
    const cnt = Number(r.cnt);
    // Higher alignment = more contributions from issue-aligned sources
    const alignmentScore = Math.min(100, Math.round((total / 10000) * 50 + (cnt / 5) * 50));
    return {
      candidateName: r.candidate_name,
      party: r.party,
      office: r.office,
      jurisdiction: r.jurisdiction,
      totalContributions: total,
      contributorCount: cnt,
      policyDomain: r.policy_domain,
      alignmentScore,
    };
  });
}

// ============================================================
// Ingestion Job Management
// ============================================================

export async function getIngestionJobs(): Promise<IngestionJobConfig[]> {
  const [rows]: any = await db.execute(sql.raw(
    `SELECT stream_id_dsr as datasetId, update_freq_dsr as updateFrequency, cron_expression_dsr as cronExpression, enabled_dsr as enabled
     FROM data_stream_registry ORDER BY stream_name_dsr`
  ));
  return (rows as any[]).map(r => ({
    datasetId: r.datasetId,
    frequency: r.updateFrequency,
    cronExpression: r.cronExpression,
    enabled: Boolean(r.enabled),
  }));
}

export async function updateIngestionJob(
  datasetId: string,
  updates: { enabled?: boolean; cronExpression?: string; frequency?: string }
): Promise<boolean> {
  const setClauses: string[] = [];
  if (updates.enabled !== undefined) setClauses.push(`enabled_dsr = ${updates.enabled ? 1 : 0}`);
  if (updates.cronExpression) setClauses.push(`cron_expression_dsr = '${updates.cronExpression.replace(/'/g, "''")}'`);
  if (updates.frequency) setClauses.push(`update_freq_dsr = '${updates.frequency.replace(/'/g, "''")}'`);
  if (!setClauses.length) return false;
  setClauses.push(`updated_at_dsr = ${Date.now()}`);;
  await db.execute(sql.raw(
    `UPDATE data_stream_registry SET ${setClauses.join(', ')} WHERE stream_id_dsr = '${datasetId.replace(/'/g, "''")}'`
  ));
  return true;
}

// ============================================================
// Cross-Dataset Intelligence Summary
// ============================================================

export async function getCrossDatasetIntelligence(): Promise<{
  signals: SignalFromDataset[];
  patterns: PatternFromDataset[];
  trends: TrendFromDataset[];
  policyProposals: number;
  interventionTargets: number;
}> {
  const [signals, enfSignals, patterns, gaps, trends, enfTrends, proposals, targets] = await Promise.all([
    extractSignalsFromComplaints(undefined, 10),
    extractSignalsFromEnforcement(undefined, 10),
    detectRepeatOffenders(3, 10),
    detectRegulatoryGaps(5),
    analyzeComplaintTrends(),
    analyzeEnforcementTrends(),
    getPolicyChangeProposals(),
    generateInterventionTargets(undefined, 10),
  ]);

  return {
    signals: [...signals, ...enfSignals].slice(0, 15),
    patterns: [...patterns, ...gaps].slice(0, 10),
    trends: [...trends, ...enfTrends].slice(0, 10),
    policyProposals: proposals.length,
    interventionTargets: targets.length,
  };
}

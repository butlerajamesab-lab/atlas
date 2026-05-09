/**
 * Dataset Connector Router
 * 
 * Exposes public dataset intelligence through tRPC endpoints:
 * - Dataset registry listing and management
 * - Signal extraction from complaints and enforcement
 * - Pattern detection (repeat offenders, regulatory gaps)
 * - Trend analysis (complaint growth, enforcement frequency)
 * - Intervention targeting
 * - Policy change proposals
 * - Campaign finance analysis
 * - Cross-dataset intelligence summary
 * - Ingestion job management
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  listDatasets,
  getDatasetById,
  getDatasetSummary,
  extractSignalsFromComplaints,
  extractSignalsFromEnforcement,
  detectRepeatOffenders,
  detectRegulatoryGaps,
  analyzeComplaintTrends,
  analyzeEnforcementTrends,
  generateInterventionTargets,
  getPolicyChangeProposals,
  analyzeCampaignFinance,
  getIngestionJobs,
  updateIngestionJob,
  getCrossDatasetIntelligence,
} from "../dataset-connector-service";

export const datasetConnectorRouter = router({
  // ── Registry ──
  list: protectedProcedure.query(async () => {
    return listDatasets();
  }),

  getById: protectedProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ input }) => {
      return getDatasetById(input.datasetId);
    }),

  summary: protectedProcedure.query(async () => {
    return getDatasetSummary();
  }),

  // ── Signal Extraction ──
  signalsFromComplaints: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return extractSignalsFromComplaints(input.jurisdiction, input.limit);
    }),

  signalsFromEnforcement: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return extractSignalsFromEnforcement(input.jurisdiction, input.limit);
    }),

  // ── Pattern Detection ──
  repeatOffenders: protectedProcedure
    .input(z.object({ minOccurrences: z.number().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return detectRepeatOffenders(input.minOccurrences, input.limit);
    }),

  regulatoryGaps: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }) => {
      return detectRegulatoryGaps(input.limit);
    }),

  // ── Trend Analysis ──
  complaintTrends: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional() }))
    .query(async ({ input }) => {
      return analyzeComplaintTrends(input.jurisdiction);
    }),

  enforcementTrends: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional() }))
    .query(async ({ input }) => {
      return analyzeEnforcementTrends(input.jurisdiction);
    }),

  // ── Strategy & Intervention ──
  interventionTargets: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return generateInterventionTargets(input.jurisdiction, input.limit);
    }),

  // ── Reform & Policy ──
  policyProposals: protectedProcedure
    .input(z.object({ jurisdiction: z.string().optional(), status: z.string().optional() }))
    .query(async ({ input }) => {
      return getPolicyChangeProposals(input.jurisdiction, input.status);
    }),

  // ── Campaign Finance ──
  campaignFinance: protectedProcedure
    .input(z.object({ policyDomain: z.string().optional(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      return analyzeCampaignFinance(input.policyDomain, input.limit);
    }),

  // ── Ingestion Jobs ──
  ingestionJobs: protectedProcedure.query(async () => {
    return getIngestionJobs();
  }),

  updateIngestionJob: protectedProcedure
    .input(z.object({
      datasetId: z.string(),
      enabled: z.boolean().optional(),
      cronExpression: z.string().optional(),
      frequency: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return updateIngestionJob(input.datasetId, input);
    }),

  // ── Cross-Dataset Intelligence ──
  intelligence: protectedProcedure.query(async () => {
    return getCrossDatasetIntelligence();
  }),
});

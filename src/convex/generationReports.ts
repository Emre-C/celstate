import { v } from "convex/values";
import { internalQuery } from "./_generated/server.js";
import {
  generationStatusValidator,
  transparentQaDecisionValidator,
  transparentQaReasonCodeValidator,
} from "./lib/validation/validators.js";
import {
  TRANSPARENT_QA_NUMERIC_METRIC_KEYS,
  type TransparentQaNumericMetricKey,
  type TransparentQaReasonCode,
} from "./lib/qa/transparentQa.js";
import type { GenerationStatus } from "../lib/generation-types.js";

type GenerationStatusFilter = GenerationStatus;

const generationStatusFilterValidator = generationStatusValidator;

interface TransparentQaMetricDistributionSummary {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
}

const transparentQaMetricDistributionValidator = v.object({
  count: v.number(),
  min: v.union(v.number(), v.null()),
  max: v.union(v.number(), v.null()),
  avg: v.union(v.number(), v.null()),
  p10: v.union(v.number(), v.null()),
  p50: v.union(v.number(), v.null()),
  p90: v.union(v.number(), v.null()),
  p95: v.union(v.number(), v.null()),
});

const transparentQaMetricDistributionFields = Object.fromEntries(
  TRANSPARENT_QA_NUMERIC_METRIC_KEYS.map((key) => [key, transparentQaMetricDistributionValidator]),
) as Record<TransparentQaNumericMetricKey, typeof transparentQaMetricDistributionValidator>;

const transparentQaMetricsReportValidator = v.object({
  filters: v.object({
    statuses: v.array(generationStatusFilterValidator),
    decision: v.union(transparentQaDecisionValidator, v.null()),
    reasonCode: v.union(transparentQaReasonCodeValidator, v.null()),
  }),
  totals: v.object({
    scannedGenerations: v.number(),
    matchingGenerations: v.number(),
    returnedSamples: v.number(),
    scanLimit: v.number(),
    sampleLimit: v.number(),
    scanLimitReached: v.boolean(),
  }),
  statusCounts: v.object({
    complete: v.number(),
    generating: v.number(),
    failed: v.number(),
  }),
  decisionCounts: v.object({
    pass: v.number(),
    retry_black: v.number(),
    retry_white_and_black: v.number(),
    review: v.number(),
  }),
  reasonCodeCounts: v.array(v.object({
    reasonCode: transparentQaReasonCodeValidator,
    count: v.number(),
  })),
  metricDistributions: v.object(transparentQaMetricDistributionFields),
  recentSamples: v.array(v.object({
    generationId: v.id("generations"),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    status: generationStatusFilterValidator,
    decision: transparentQaDecisionValidator,
    reasonCodes: v.array(transparentQaReasonCodeValidator),
    alphaPresence: v.number(),
    borderTransparencyRatio: v.number(),
    recompositionResidual: v.number(),
    channelDisagreement: v.number(),
    alphaResidual: v.number(),
    boundaryErrorRate: v.number(),
    externalSpill: v.number(),
    haloTail: v.number(),
    topologyVolatility: v.number(),
    fragmentNoise: v.number(),
    persistentHoleCount: v.number(),
    fragileHoleCount: v.number(),
  })),
  window: v.object({
    hoursWindow: v.number(),
    now: v.number(),
    since: v.number(),
  }),
});

function clampTransparentQaReportHoursWindow(hoursWindow: number | undefined): number {
  if (hoursWindow === undefined || !Number.isFinite(hoursWindow)) {
    return 24 * 7;
  }

  return Math.min(Math.max(Math.floor(hoursWindow), 1), 24 * 30);
}

function clampTransparentQaReportScanLimit(scanLimit: number | undefined): number {
  if (scanLimit === undefined || !Number.isFinite(scanLimit)) {
    return 200;
  }

  return Math.min(Math.max(Math.floor(scanLimit), 10), 1000);
}

function clampTransparentQaReportSampleLimit(
  sampleLimit: number | undefined,
  scanLimit: number,
): number {
  if (sampleLimit === undefined || !Number.isFinite(sampleLimit)) {
    return Math.min(scanLimit, 25);
  }

  return Math.min(Math.max(Math.floor(sampleLimit), 1), Math.min(scanLimit, 100));
}

function createEmptyTransparentQaMetricBuckets(): Record<TransparentQaNumericMetricKey, number[]> {
  return Object.fromEntries(
    TRANSPARENT_QA_NUMERIC_METRIC_KEYS.map((key) => [key, [] as number[]]),
  ) as Record<TransparentQaNumericMetricKey, number[]>;
}

function getPercentile(sortedValues: number[], percentile: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const boundedPercentile = Math.max(0, Math.min(1, percentile));
  const index = (sortedValues.length - 1) * boundedPercentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex]!;
  const upperValue = sortedValues[upperIndex]!;

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex);
}

function summarizeTransparentQaMetricValues(values: number[]): TransparentQaMetricDistributionSummary {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      p10: null,
      p50: null,
      p90: null,
      p95: null,
    };
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    count: values.length,
    min: sortedValues[0] ?? null,
    max: sortedValues[sortedValues.length - 1] ?? null,
    avg: total / values.length,
    p10: getPercentile(sortedValues, 0.1),
    p50: getPercentile(sortedValues, 0.5),
    p90: getPercentile(sortedValues, 0.9),
    p95: getPercentile(sortedValues, 0.95),
  };
}

export const getTransparentQaMetricsReport = internalQuery({
  args: {
    now: v.number(),
    hoursWindow: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
    sampleLimit: v.optional(v.number()),
    status: v.optional(generationStatusFilterValidator),
    decision: v.optional(transparentQaDecisionValidator),
    reasonCode: v.optional(transparentQaReasonCodeValidator),
  },
  returns: transparentQaMetricsReportValidator,
  handler: async (ctx, args) => {
    const hoursWindow = clampTransparentQaReportHoursWindow(args.hoursWindow);
    const scanLimit = clampTransparentQaReportScanLimit(args.scanLimit);
    const sampleLimit = clampTransparentQaReportSampleLimit(args.sampleLimit, scanLimit);
    const since = args.now - hoursWindow * 60 * 60 * 1000;
    const statuses: GenerationStatusFilter[] = args.status ? [args.status] : ["complete", "failed"];

    const scannedGenerations = await ctx.db
      .query("generations")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since).lte("createdAt", args.now))
      .order("desc")
      .take(scanLimit);

    const matchingGenerations = scannedGenerations.filter((generation) => {
      const transparentQa = generation.transparentQa;
      if (!transparentQa) {
        return false;
      }
      if (!statuses.includes(generation.status)) {
        return false;
      }
      if (args.decision && transparentQa.decision !== args.decision) {
        return false;
      }
      if (args.reasonCode && !transparentQa.reasonCodes.includes(args.reasonCode)) {
        return false;
      }
      return true;
    });

    const statusCounts = {
      complete: 0,
      generating: 0,
      failed: 0,
    };
    const decisionCounts = {
      pass: 0,
      retry_black: 0,
      retry_white_and_black: 0,
      review: 0,
    };
    const reasonCodeCounts = new Map<TransparentQaReasonCode, number>();
    const metricBuckets = createEmptyTransparentQaMetricBuckets();

    for (const generation of matchingGenerations) {
      const transparentQa = generation.transparentQa!;
      statusCounts[generation.status] += 1;
      decisionCounts[transparentQa.decision] += 1;

      for (const reasonCode of transparentQa.reasonCodes) {
        reasonCodeCounts.set(reasonCode, (reasonCodeCounts.get(reasonCode) ?? 0) + 1);
      }

      for (const metricKey of TRANSPARENT_QA_NUMERIC_METRIC_KEYS) {
        metricBuckets[metricKey].push(transparentQa.metrics[metricKey]);
      }
    }

    const metricDistributions = Object.fromEntries(
      TRANSPARENT_QA_NUMERIC_METRIC_KEYS.map((metricKey) => [
        metricKey,
        summarizeTransparentQaMetricValues(metricBuckets[metricKey]),
      ]),
    ) as Record<TransparentQaNumericMetricKey, TransparentQaMetricDistributionSummary>;

    const recentSamples = matchingGenerations.slice(0, sampleLimit).map((generation) => {
      const transparentQa = generation.transparentQa!;
      return {
        generationId: generation._id,
        createdAt: generation.createdAt,
        completedAt: generation.completedAt,
        status: generation.status,
        decision: transparentQa.decision,
        reasonCodes: transparentQa.reasonCodes,
        alphaPresence: transparentQa.metrics.alphaPresence,
        borderTransparencyRatio: transparentQa.metrics.borderTransparencyRatio,
        recompositionResidual: transparentQa.metrics.recompositionResidual,
        channelDisagreement: transparentQa.metrics.channelDisagreement,
        alphaResidual: transparentQa.metrics.alphaResidual,
        boundaryErrorRate: transparentQa.metrics.boundaryErrorRate,
        externalSpill: transparentQa.metrics.externalSpill,
        haloTail: transparentQa.metrics.haloTail,
        topologyVolatility: transparentQa.metrics.topologyVolatility,
        fragmentNoise: transparentQa.metrics.fragmentNoise,
        persistentHoleCount: transparentQa.metrics.persistentHoleCount,
        fragileHoleCount: transparentQa.metrics.fragileHoleCount,
      };
    });

    return {
      filters: {
        statuses,
        decision: args.decision ?? null,
        reasonCode: args.reasonCode ?? null,
      },
      totals: {
        scannedGenerations: scannedGenerations.length,
        matchingGenerations: matchingGenerations.length,
        returnedSamples: recentSamples.length,
        scanLimit,
        sampleLimit,
        scanLimitReached: scannedGenerations.length === scanLimit,
      },
      statusCounts,
      decisionCounts,
      reasonCodeCounts: Array.from(reasonCodeCounts.entries())
        .map(([reasonCode, count]) => ({ reasonCode, count }))
        .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode)),
      metricDistributions,
      recentSamples,
      window: {
        hoursWindow,
        now: args.now,
        since,
      },
    };
  },
});

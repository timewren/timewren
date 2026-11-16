import { z } from "zod";
import { cached } from "@/lib/cache";
import {
  getAggregateStats,
  getCountryBreakdown,
  getDeviceBreakdown,
  getGoalConversions,
  getRealtimeVisitors,
  getTopPages,
  getTrafficSources,
  getVisitorTimeseries,
  isPlausibleConfigured,
} from "@/lib/plausible";
import { router, supporterProcedure } from "../trpc";

// Plausible analytics don't need to be real-time; cache the API responses
// briefly to avoid hammering the external API on dashboard re-renders.
const PLAUSIBLE_TTL = 300; // 5 minutes

const dateRangeSchema = z.enum(["day", "7d", "30d", "6mo", "12mo", "all"]);

export const plausibleRouter = router({
  isConfigured: supporterProcedure.query(() => {
    return isPlausibleConfigured();
  }),

  realtimeVisitors: supporterProcedure.query(async () => {
    if (!isPlausibleConfigured()) return null;
    return getRealtimeVisitors();
  }),

  getAggregateStats: supporterProcedure
    .input(z.object({ dateRange: dateRangeSchema }))
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:aggregate:${input.dateRange}`,
        PLAUSIBLE_TTL,
        () => getAggregateStats(input.dateRange),
      );
    }),

  getVisitorTimeseries: supporterProcedure
    .input(z.object({ dateRange: dateRangeSchema }))
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:timeseries:${input.dateRange}`,
        PLAUSIBLE_TTL,
        () => getVisitorTimeseries(input.dateRange),
      );
    }),

  getTopPages: supporterProcedure
    .input(
      z.object({
        dateRange: dateRangeSchema,
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:toppages:${input.dateRange}:${input.limit}`,
        PLAUSIBLE_TTL,
        () => getTopPages(input.dateRange, input.limit),
      );
    }),

  getTrafficSources: supporterProcedure
    .input(
      z.object({
        dateRange: dateRangeSchema,
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:sources:${input.dateRange}:${input.limit}`,
        PLAUSIBLE_TTL,
        () => getTrafficSources(input.dateRange, input.limit),
      );
    }),

  getDeviceBreakdown: supporterProcedure
    .input(
      z.object({
        dateRange: dateRangeSchema,
        dimension: z.enum(["device", "browser", "os"]).default("device"),
      }),
    )
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:device:${input.dateRange}:${input.dimension}`,
        PLAUSIBLE_TTL,
        () => getDeviceBreakdown(input.dateRange, input.dimension),
      );
    }),

  getCountryBreakdown: supporterProcedure
    .input(
      z.object({
        dateRange: dateRangeSchema,
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(
        `plausible:country:${input.dateRange}:${input.limit}`,
        PLAUSIBLE_TTL,
        () => getCountryBreakdown(input.dateRange, input.limit),
      );
    }),

  getGoalConversions: supporterProcedure
    .input(z.object({ dateRange: dateRangeSchema }))
    .query(async ({ input }) => {
      if (!isPlausibleConfigured()) return null;
      return cached(`plausible:goals:${input.dateRange}`, PLAUSIBLE_TTL, () =>
        getGoalConversions(input.dateRange),
      );
    }),
});

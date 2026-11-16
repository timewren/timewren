/**
 * Standardized tRPC error helpers
 * Provides consistent error handling across all routers
 */

import { TRPCError } from "@trpc/server";
import { st } from "@/i18n/sync-text";

/**
 * Common error codes and their meanings:
 * - NOT_FOUND: Resource doesn't exist
 * - BAD_REQUEST: Invalid input or business logic violation
 * - UNAUTHORIZED: Not logged in
 * - FORBIDDEN: Logged in but no permission
 * - CONFLICT: Resource already exists or state conflict
 * - INTERNAL_SERVER_ERROR: Unexpected server error
 */

// Common "not found" errors
export function notFound(message: string): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message,
  });
}

// Common "bad request" errors
export function badRequest(message: string): TRPCError {
  return new TRPCError({
    code: "BAD_REQUEST",
    message,
  });
}

// Common "forbidden" errors (user doesn't have permission)
export function forbidden(message = st("errors.accessDenied")): TRPCError {
  return new TRPCError({
    code: "FORBIDDEN",
    message,
  });
}

// Common "conflict" errors (e.g., duplicate, state conflict)
export function conflict(message: string): TRPCError {
  return new TRPCError({
    code: "CONFLICT",
    message,
  });
}

// Internal server error with logging
export function internalError(
  message = st("errors.unexpected"),
  cause?: unknown,
): TRPCError {
  if (cause) {
    console.error("Internal error:", cause);
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message,
    cause,
  });
}

// Predefined error messages for common entities
export const Errors = {
  // Clients
  clientNotFound: () => notFound(st("errors.clientNotFound")),
  clientArchived: () => badRequest(st("errors.clientArchived")),

  // Projects
  projectNotFound: () => notFound(st("errors.projectNotFound")),
  projectArchived: () => badRequest(st("errors.projectArchived")),

  // Time entries
  timeEntryNotFound: () => notFound(st("errors.timeEntryNotFound")),
  timeEntriesNotFound: () => badRequest(st("errors.timeEntriesNotFound")),

  // Prepaid packages
  prepaidNotFound: () => notFound(st("errors.prepaidNotFound")),
  prepaidInactive: () => badRequest(st("errors.prepaidInactive")),
  prepaidInsufficientHours: (available: number) =>
    badRequest(
      st("errors.prepaidInsufficientHours", {
        available: available.toFixed(2),
      }),
    ),
  prepaidHasUsage: () => badRequest(st("errors.prepaidHasUsage")),

  // Invoices
  invoiceNotFound: () => notFound(st("errors.invoiceNotFound")),
  invoiceAlreadySent: () => badRequest(st("errors.invoiceAlreadySent")),
  invoiceAlreadyPaid: () => badRequest(st("errors.invoiceAlreadyPaid")),

  // Users
  userNotFound: () => notFound(st("errors.userNotFound")),

  // Generic
  invalidInput: (field: string) =>
    badRequest(st("errors.invalidValue", { field })),
  operationFailed: (operation: string) =>
    badRequest(st("errors.operationFailed", { operation })),
} as const;

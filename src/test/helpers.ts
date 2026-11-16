/**
 * Test helpers for mocking tRPC context and database operations.
 *
 * Strategy: We mock ctx.db at the Drizzle level. Each test can override
 * specific query results to test business logic without a real database.
 */
import { vi } from "vitest";
import { TEST_USER_ID } from "./fixtures";

/**
 * Creates a mock Drizzle DB object with chainable query/insert/update/delete.
 * Override specific methods in individual tests as needed.
 */
export function createMockDb(overrides: Record<string, unknown> = {}) {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockFor = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: mockReturning }),
  });
  const _mockWhere = vi.fn().mockReturnValue({
    returning: mockReturning,
    for: mockFor,
  });

  const mockSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            for: mockFor,
          }),
        }),
        limit: vi.fn().mockReturnValue({
          for: mockFor,
        }),
      }),
    }),
  });

  const db = {
    query: {
      users: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      clients: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      projects: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      timeEntries: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invoices: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      prepaidPackages: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      prepaidUsage: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      tasks: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      invoiceLines: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      rateHistory: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      emailPreferences: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      timeEntrySegments: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi
      .fn()
      .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        // By default, pass the db itself as the transaction
        return fn(db);
      }),
    ...overrides,
  };

  return db;
}

/**
 * Creates a mock authenticated session.
 */
export function createMockSession(userId = TEST_USER_ID) {
  return {
    user: {
      id: userId,
      name: "Test Bruger",
      email: "test@example.com",
    },
    session: {
      id: "session-001",
      userId,
    },
  };
}

/**
 * Creates a mock tRPC context for protectedProcedure.
 */
export function createMockContext(
  userId = TEST_USER_ID,
  dbOverrides: Record<string, unknown> = {},
) {
  return {
    session: createMockSession(userId),
    db: createMockDb(dbOverrides),
    headers: new Headers(),
  };
}

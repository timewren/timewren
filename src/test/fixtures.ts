/**
 * Shared test fixtures for unit tests.
 * Provides realistic mock data matching the DB schema shapes.
 */

export const TEST_USER_ID = "user-00000000-0000-0000-0000-000000000001";
export const TEST_USER_ID_2 = "user-00000000-0000-0000-0000-000000000002";

export const TEST_CLIENT_ID = "client-0000-0000-0000-000000000001";
export const TEST_CLIENT_ID_2 = "client-0000-0000-0000-000000000002";

export const TEST_PROJECT_ID = "project-000-0000-0000-000000000001";
export const TEST_PROJECT_ID_2 = "project-000-0000-0000-000000000002";

export const TEST_TIME_ENTRY_ID = "te-00000000-0000-0000-0000-000000000001";
export const TEST_TIME_ENTRY_ID_2 = "te-00000000-0000-0000-0000-000000000002";

export const TEST_INVOICE_ID = "inv-0000-0000-0000-0000-000000000001";
export const TEST_INVOICE_ID_2 = "inv-0000-0000-0000-0000-000000000002";

export const TEST_PREPAID_ID = "prepaid-000-0000-0000-000000000001";
export const TEST_PREPAID_ID_2 = "prepaid-000-0000-0000-000000000002";

export const TEST_TASK_ID = "task-0000-0000-0000-0000-000000000001";

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_USER_ID,
    name: "Test Bruger",
    email: "test@example.com",
    defaultHourlyRate: "500",
    weeklyHourGoal: "37",
    role: "user",
    prepaidAlertRecipient: "owner",
    ...overrides,
  };
}

export function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_CLIENT_ID,
    userId: TEST_USER_ID,
    name: "Acme ApS",
    email: "acme@example.com",
    phone: "12345678",
    company: "Acme ApS",
    address: "Hovedgaden 1",
    city: "København",
    postalCode: "1000",
    country: "Danmark",
    cvrNumber: "12345678",
    notes: null,
    defaultHourlyRate: "750",
    isActive: true,
    isArchived: false,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROJECT_ID,
    userId: TEST_USER_ID,
    clientId: TEST_CLIENT_ID,
    name: "Website Redesign",
    hourlyRate: "900",
    isActive: true,
    isArchived: false,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    client: makeClient(),
    ...overrides,
  };
}

export function makeTimeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_TIME_ENTRY_ID,
    userId: TEST_USER_ID,
    projectId: TEST_PROJECT_ID,
    clientId: TEST_CLIENT_ID,
    description: "Udvikling af frontend",
    notes: null,
    hours: "2.5",
    date: new Date("2025-06-15"),
    startTime: null,
    endTime: null,
    billableRate: "900",
    isBillable: true,
    isBilled: false,
    isPrepaid: false,
    invoiceId: null,
    prepaidPackageId: null,
    taskId: null,
    source: "manual" as const,
    createdAt: new Date("2025-06-15"),
    ...overrides,
  };
}

// makeInvoice og makePrepaidPackage er fjernet: faktura- og klippekort-
// testene kører mod den rigtige kode (#1113) og bygger de rækker, routeren
// faktisk læser — en fixtur ingen test længere brugte var en fil, man kunne
// rette uden at noget reagerede.

export function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_TASK_ID,
    userId: TEST_USER_ID,
    title: "Implementer login",
    actualMinutes: 120,
    estimatedMinutes: 240,
    createdAt: new Date("2025-06-01"),
    updatedAt: new Date("2025-06-01"),
    ...overrides,
  };
}

/**
 * Server-side data export utility for GDPR full exports
 * Generates a complete data package for a user
 */

import { eq } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import {
  clients,
  companyProfiles,
  emailPreferences,
  invoices,
  notificationChannels,
  prepaidPackages,
  projects,
  rateHistory,
  tasks,
  timeEntries,
  timerTemplates,
  users,
} from "@/lib/db/schema";

export interface ExportDataSet {
  metadata: {
    exportedAt: string;
    format: "json" | "csv";
    userId: string;
    totalRecords: number;
  };
  profile: Record<string, unknown>;
  companyProfile: Record<string, unknown> | null;
  clients: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  timeEntries: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  invoiceLines: Record<string, unknown>[];
  prepaidPackages: Record<string, unknown>[];
  prepaidUsage: Record<string, unknown>[];
  rateHistory: Record<string, unknown>[];
  timerTemplates: Record<string, unknown>[];
  emailPreferences: Record<string, unknown> | null;
  notificationChannels: Record<string, unknown>[];
}

/**
 * Generate a full data export for a user (GDPR compliant)
 * Excludes: passwords, OAuth tokens, sessions, 2FA secrets, integration sync logs
 */
export async function generateUserDataExport(
  db: typeof dbType,
  userId: string,
): Promise<ExportDataSet> {
  // Fetch all user data in parallel
  const [
    user,
    company,
    userClients,
    userProjects,
    userTimeEntries,
    userTasks,
    userInvoices,
    userPrepaid,
    userTimerTemplates,
    userEmailPrefs,
    userNotificationChannels,
    userRateHistory,
  ] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.companyProfiles.findFirst({
      where: eq(companyProfiles.userId, userId),
    }),
    db.query.clients.findMany({ where: eq(clients.userId, userId) }),
    db.query.projects.findMany({
      where: eq(projects.userId, userId),
      with: { client: { columns: { name: true } } },
    }),
    db.query.timeEntries.findMany({
      where: eq(timeEntries.userId, userId),
      with: {
        project: { columns: { name: true } },
        client: { columns: { name: true } },
      },
    }),
    db.query.tasks.findMany({
      where: eq(tasks.userId, userId),
      with: {
        project: { columns: { name: true } },
        client: { columns: { name: true } },
      },
    }),
    db.query.invoices.findMany({
      where: eq(invoices.userId, userId),
      with: {
        client: { columns: { name: true } },
        lines: true,
      },
    }),
    db.query.prepaidPackages.findMany({
      where: eq(prepaidPackages.userId, userId),
      with: {
        client: { columns: { name: true } },
        usageHistory: true,
      },
    }),
    db.query.timerTemplates.findMany({
      where: eq(timerTemplates.userId, userId),
      with: {
        project: { columns: { name: true } },
        client: { columns: { name: true } },
      },
    }),
    db.query.emailPreferences.findFirst({
      where: eq(emailPreferences.userId, userId),
    }),
    db.query.notificationChannels.findMany({
      where: eq(notificationChannels.userId, userId),
    }),
    db.query.rateHistory.findMany({
      where: eq(rateHistory.userId, userId),
      with: {
        client: { columns: { name: true } },
        project: { columns: { name: true } },
      },
    }),
  ]);

  // Flatten invoice lines and prepaid usage
  const allInvoiceLines = userInvoices.flatMap((inv) =>
    (inv.lines || []).map((line) => ({
      invoiceNumber: inv.invoiceNumber,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      sortOrder: line.sortOrder,
    })),
  );

  const allPrepaidUsage = userPrepaid.flatMap((pkg) =>
    (pkg.usageHistory || []).map((usage) => ({
      packageName: pkg.name,
      hoursUsed: usage.hoursUsed,
      valueUsed: usage.valueUsed,
      description: usage.description,
      createdAt: usage.createdAt,
    })),
  );

  // Build safe profile (exclude sensitive fields)
  const safeProfile = user
    ? {
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        defaultHourlyRate: user.defaultHourlyRate,
        weeklyHourGoal: user.weeklyHourGoal,
        timezone: user.timezone,
        workingHoursStart: user.workingHoursStart,
        workingHoursEnd: user.workingHoursEnd,
        workingDays: user.workingDays,
        onboardingCompleted: user.onboardingCompleted,
        createdAt: user.createdAt,
      }
    : {};

  const safeCompany = company
    ? {
        name: company.name,
        cvrNumber: company.cvrNumber,
        email: company.email,
        phone: company.phone,
        address: company.address,
        postalCode: company.postalCode,
        city: company.city,
        country: company.country,
        vatRegistered: company.vatRegistered,
        vatNumber: company.vatNumber,
      }
    : null;

  const exportClients = userClients.map((c) => ({
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    address: c.address,
    city: c.city,
    postalCode: c.postalCode,
    country: c.country,
    cvrNumber: c.cvrNumber,
    notes: c.notes,
    defaultHourlyRate: c.defaultHourlyRate,
    isActive: c.isActive,
    isArchived: c.isArchived,
    createdAt: c.createdAt,
  }));

  const exportProjects = userProjects.map((p) => ({
    name: p.name,
    description: p.description,
    clientName: p.client?.name || "",
    hourlyRate: p.hourlyRate,
    fixedPrice: p.fixedPrice,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    createdAt: p.createdAt,
  }));

  const exportTimeEntries = userTimeEntries.map((t) => ({
    date: t.date,
    description: t.description,
    notes: t.notes,
    hours: t.hours,
    startTime: t.startTime,
    endTime: t.endTime,
    billableRate: t.billableRate,
    isBillable: t.isBillable,
    isBilled: t.isBilled,
    isPrepaid: t.isPrepaid,
    source: t.source,
    projectName: t.project?.name || "",
    clientName: t.client?.name || "",
    createdAt: t.createdAt,
  }));

  const exportTasks = userTasks.map((t) => ({
    title: t.title,
    description: t.description,
    projectName: t.project?.name || "",
    clientName: t.client?.name || "",
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    completedAt: t.completedAt,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: t.actualMinutes,
    sourceType: t.sourceType,
    createdAt: t.createdAt,
  }));

  const exportInvoices = userInvoices.map((i) => ({
    invoiceNumber: i.invoiceNumber,
    clientName: i.client?.name || "",
    amount: i.amount,
    status: i.status,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    paidDate: i.paidDate,
    notes: i.notes,
    createdAt: i.createdAt,
  }));

  const exportPrepaid = userPrepaid.map((p) => ({
    name: p.name,
    clientName: p.client?.name || "",
    totalHours: p.totalHours,
    usedHours: p.usedHours,
    remainingHours: p.remainingHours,
    hourlyRate: p.hourlyRate,
    totalValue: p.totalValue,
    purchaseDate: p.purchaseDate,
    expiryDate: p.expiryDate,
    isActive: p.isActive,
  }));

  const exportRateHistory = userRateHistory.map((r) => ({
    clientName: r.client?.name || "",
    projectName: r.project?.name || "",
    oldRate: r.oldRate,
    newRate: r.newRate,
    rateType: r.rateType,
    effectiveDate: r.effectiveDate,
    reason: r.reason,
  }));

  const exportTimerTemplates = userTimerTemplates.map((t) => ({
    name: t.name,
    projectName: t.project?.name || "",
    clientName: t.client?.name || "",
    description: t.description,
    color: t.color,
    isFavorite: t.isFavorite,
  }));

  const exportEmailPrefs = userEmailPrefs
    ? {
        weeklyReport: userEmailPrefs.weeklyReport,
        monthlyReport: userEmailPrefs.monthlyReport,
        unbilledReminder: userEmailPrefs.unbilledReminder,
        passwordChanged: userEmailPrefs.passwordChanged,
        newLoginAlert: userEmailPrefs.newLoginAlert,
        inactivityReminder: userEmailPrefs.inactivityReminder,
      }
    : null;

  const exportNotificationChannels = userNotificationChannels.map((nc) => ({
    channelType: nc.channelType,
    isEnabled: nc.isEnabled,
    sendDailyDigest: nc.sendDailyDigest,
    sendDeadlineReminders: nc.sendDeadlineReminders,
  }));

  const totalRecords =
    exportClients.length +
    exportProjects.length +
    exportTimeEntries.length +
    exportTasks.length +
    exportInvoices.length +
    allInvoiceLines.length +
    exportPrepaid.length +
    allPrepaidUsage.length +
    exportRateHistory.length +
    exportTimerTemplates.length;

  return {
    metadata: {
      exportedAt: new Date().toISOString(),
      format: "json",
      userId,
      totalRecords,
    },
    profile: safeProfile,
    companyProfile: safeCompany,
    clients: exportClients,
    projects: exportProjects,
    timeEntries: exportTimeEntries,
    tasks: exportTasks,
    invoices: exportInvoices,
    invoiceLines: allInvoiceLines,
    prepaidPackages: exportPrepaid,
    prepaidUsage: allPrepaidUsage,
    rateHistory: exportRateHistory,
    timerTemplates: exportTimerTemplates,
    emailPreferences: exportEmailPrefs,
    notificationChannels: exportNotificationChannels,
  };
}

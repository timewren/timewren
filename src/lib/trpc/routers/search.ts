import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { st } from "@/i18n/server-text";
import { db } from "@/lib/db";
import {
  clients,
  invoices,
  prepaidPackages,
  projects,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import { canViewAllOrgTime } from "@/lib/permissions/server";
import { protectedProcedure, router } from "../trpc";

export const searchRouter = router({
  /**
   * Global search across all entities
   */
  global: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100),
        limit: z.number().min(1).max(20).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { query, limit } = input;
      const userId = ctx.session.user.id;
      const searchPattern = `%${query}%`;

      const clientScope = ctx.orgId
        ? eq(clients.organizationId, ctx.orgId)
        : eq(clients.userId, userId);
      const projectScope = ctx.orgId
        ? eq(projects.organizationId, ctx.orgId)
        : eq(projects.userId, userId);
      // Time entries follow the "members see only own time" model: a regular
      // member only finds their own entries in search; owner/admin see all org
      // time. Other entities (clients/projects/invoices/...) are org-shared.
      const canSeeAllTime = await canViewAllOrgTime(db, ctx.orgId, userId);
      const timeEntryScope =
        ctx.orgId && canSeeAllTime
          ? eq(timeEntries.organizationId, ctx.orgId)
          : eq(timeEntries.userId, userId);
      const invoiceScope = ctx.orgId
        ? eq(invoices.organizationId, ctx.orgId)
        : eq(invoices.userId, userId);
      const prepaidScope = ctx.orgId
        ? eq(prepaidPackages.organizationId, ctx.orgId)
        : eq(prepaidPackages.userId, userId);
      const taskScope = ctx.orgId
        ? eq(tasks.organizationId, ctx.orgId)
        : eq(tasks.userId, userId);

      // Search clients
      const clientResults = await db
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          company: clients.company,
        })
        .from(clients)
        .where(
          and(
            clientScope,
            eq(clients.isArchived, false),
            or(
              ilike(clients.name, searchPattern),
              ilike(clients.email, searchPattern),
              ilike(clients.company, searchPattern),
            ),
          ),
        )
        .limit(limit);

      // Search projects (filter out projects from archived clients)
      const projectResults = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          clientName: clients.name,
          clientId: projects.clientId,
        })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            projectScope,
            eq(clients.isArchived, false),
            or(
              ilike(projects.name, searchPattern),
              ilike(projects.description, searchPattern),
            ),
          ),
        )
        .limit(limit);

      // Search time entries by description
      const timeEntryResults = await db
        .select({
          id: timeEntries.id,
          description: timeEntries.description,
          date: timeEntries.date,
          hours: timeEntries.hours,
          projectName: projects.name,
          clientName: clients.name,
        })
        .from(timeEntries)
        .leftJoin(projects, eq(timeEntries.projectId, projects.id))
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(timeEntryScope, ilike(timeEntries.description, searchPattern)),
        )
        .orderBy(desc(timeEntries.date))
        .limit(limit);

      // Search invoices by number
      const invoiceResults = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          clientName: clients.name,
          amount: invoices.amount,
          status: invoices.status,
          issueDate: invoices.issueDate,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .where(and(invoiceScope, ilike(invoices.invoiceNumber, searchPattern)))
        .orderBy(desc(invoices.issueDate))
        .limit(limit);

      // Search prepaid packages (klippekort)
      const prepaidResults = await db
        .select({
          id: prepaidPackages.id,
          name: prepaidPackages.name,
          clientName: clients.name,
          remainingHours: prepaidPackages.remainingHours,
          isActive: prepaidPackages.isActive,
        })
        .from(prepaidPackages)
        .leftJoin(clients, eq(prepaidPackages.clientId, clients.id))
        .where(and(prepaidScope, ilike(prepaidPackages.name, searchPattern)))
        .limit(limit);

      // Search tasks
      const taskResults = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          projectName: projects.name,
          clientName: clients.name,
        })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(
          and(
            taskScope,
            or(
              ilike(tasks.title, searchPattern),
              ilike(tasks.description, searchPattern),
            ),
          ),
        )
        .limit(limit);

      return {
        clients: clientResults.map((c) => ({
          type: "client" as const,
          id: c.id,
          title: c.name,
          subtitle: c.company || c.email || undefined,
          url: `/dashboard/clients/${c.id}`,
        })),
        projects: projectResults.map((p) => ({
          type: "project" as const,
          id: p.id,
          title: p.name,
          subtitle: p.clientName || undefined,
          url: `/dashboard/projects/${p.id}`,
        })),
        timeEntries: timeEntryResults.map((t) => ({
          type: "timeEntry" as const,
          id: t.id,
          title: t.description || st("search.timeEntryTitle"),
          subtitle: st("search.timeSubtitle", {
            project: t.projectName || st("common.unknownProject"),
            hours: t.hours,
          }),
          url: `/dashboard/time?entry=${t.id}`,
        })),
        invoices: invoiceResults.map((i) => ({
          type: "invoice" as const,
          id: i.id,
          title: st("search.invoiceTitle", { number: i.invoiceNumber }),
          subtitle: st("search.invoiceSubtitle", {
            client: i.clientName || st("common.unknown"),
            status: i.status ?? "",
          }),
          url: `/dashboard/invoices/${i.id}`,
        })),
        prepaid: prepaidResults.map((p) => ({
          type: "prepaid" as const,
          id: p.id,
          title: p.name,
          subtitle: st("search.prepaidSubtitle", {
            client: p.clientName || st("common.unknown"),
            hours: parseFloat(p.remainingHours || "0").toFixed(1),
          }),
          url: `/dashboard/klippekort/${p.id}`,
        })),
        tasks: taskResults.map((t) => ({
          type: "task" as const,
          id: t.id,
          title: t.title,
          subtitle: st("search.taskSubtitle", {
            project: t.projectName || st("common.unknown"),
            status: t.status,
          }),
          url: `/dashboard/tasks?task=${t.id}`,
        })),
      };
    }),
});

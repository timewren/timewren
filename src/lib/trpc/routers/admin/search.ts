import { desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import {
  changelogs,
  roadmapItems,
  supportTickets,
  users,
} from "@/lib/db/schema";
import { router, supporterProcedure } from "../../trpc";

export type AdminSearchType = "user" | "ticket" | "roadmap" | "changelog";

export interface AdminSearchResult {
  type: AdminSearchType;
  id: string;
  title: string;
  subtitle?: string | null;
  url: string;
}

export const adminSearchRouter = router({
  /**
   * Global search across the most useful admin entities. Each section is
   * capped to a few rows so the result set stays small and fast.
   */
  global: supporterProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(100),
      }),
    )
    .query(async ({ ctx, input }): Promise<AdminSearchResult[]> => {
      const q = `%${input.query}%`;
      const limitPerType = 5;

      const [userRows, ticketRows, roadmapRows, changelogRows] =
        await Promise.all([
          ctx.db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              role: users.role,
            })
            .from(users)
            .where(
              or(
                ilike(users.name, q),
                ilike(users.email, q),
                eq(users.id, input.query),
              ),
            )
            .orderBy(desc(users.createdAt))
            .limit(limitPerType),

          ctx.db
            .select({
              id: supportTickets.id,
              subject: supportTickets.subject,
              status: supportTickets.status,
              senderEmail: supportTickets.senderEmail,
              updatedAt: supportTickets.updatedAt,
            })
            .from(supportTickets)
            .where(
              or(
                ilike(supportTickets.subject, q),
                ilike(supportTickets.senderEmail, q),
              ),
            )
            .orderBy(desc(supportTickets.updatedAt))
            .limit(limitPerType),

          ctx.db
            .select({
              id: roadmapItems.id,
              title: roadmapItems.title,
              status: roadmapItems.status,
            })
            .from(roadmapItems)
            .where(
              or(
                ilike(roadmapItems.title, q),
                ilike(roadmapItems.description, q),
              ),
            )
            .orderBy(desc(roadmapItems.updatedAt))
            .limit(limitPerType),

          ctx.db
            .select({
              id: changelogs.id,
              title: changelogs.title,
              version: changelogs.version,
            })
            .from(changelogs)
            .where(
              or(
                ilike(changelogs.title, q),
                ilike(changelogs.version, q),
                ilike(changelogs.content, q),
              ),
            )
            .orderBy(desc(changelogs.publishedAt))
            .limit(limitPerType),
        ]);

      const results: AdminSearchResult[] = [];

      for (const u of userRows) {
        results.push({
          type: "user",
          id: u.id,
          title: u.name || u.email,
          subtitle: `${u.email}${u.role && u.role !== "user" ? ` · ${u.role}` : ""}`,
          url: `/admin/users/${u.id}`,
        });
      }

      for (const t of ticketRows) {
        results.push({
          type: "ticket",
          id: t.id,
          title: t.subject,
          subtitle: `${t.status} · ${t.senderEmail}`,
          url: `/admin/support/${t.id}`,
        });
      }

      for (const r of roadmapRows) {
        results.push({
          type: "roadmap",
          id: r.id,
          title: r.title,
          subtitle: r.status,
          url: "/admin/roadmap",
        });
      }

      for (const c of changelogRows) {
        results.push({
          type: "changelog",
          id: c.id,
          title: c.title,
          subtitle: `v${c.version}`,
          url: "/admin/settings",
        });
      }

      return results;
    }),
});

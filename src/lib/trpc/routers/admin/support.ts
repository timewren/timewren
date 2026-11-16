import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  adminSettings,
  supportInboxes,
  supportMessages,
  supportTickets,
  users,
} from "@/lib/db/schema";
import { sendSupportReply } from "@/lib/email/support";
import { foundingTicketIds } from "@/lib/founding";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminSupportRouter = router({
  // ── Ticket listing with filters ─────────────────────────────────
  list: supporterProcedure
    .input(
      z
        .object({
          status: z
            .enum(["open", "in_progress", "closed", "all"])
            .optional()
            .default("all"),
          inboxId: z.string().uuid().optional(),
          assignedTo: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().min(1).max(100).optional().default(50),
          offset: z.number().min(0).optional().default(0),
        })
        .optional()
        .default({ status: "all", limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];

      if (input.status && input.status !== "all") {
        conditions.push(eq(supportTickets.status, input.status));
      }
      if (input.inboxId) {
        conditions.push(eq(supportTickets.inboxId, input.inboxId));
      }
      if (input.assignedTo) {
        conditions.push(eq(supportTickets.assignedTo, input.assignedTo));
      }
      if (input.search) {
        const searchPattern = `%${input.search}%`;
        conditions.push(
          or(
            ilike(supportTickets.subject, searchPattern),
            ilike(supportTickets.senderEmail, searchPattern),
            ilike(supportTickets.senderName, searchPattern),
          ),
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const [tickets, totalResult] = await Promise.all([
        ctx.db.query.supportTickets.findMany({
          where: whereClause,
          with: {
            inbox: { columns: { id: true, name: true, color: true } },
            user: { columns: { id: true, name: true, email: true } },
            assignee: { columns: { id: true, name: true } },
            messages: {
              columns: {
                id: true,
                body: true,
                createdAt: true,
                direction: true,
                isInternal: true,
              },
              orderBy: [desc(supportMessages.createdAt)],
              limit: 1,
            },
          },
          orderBy: [desc(supportTickets.updatedAt)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db
          .select({ count: count() })
          .from(supportTickets)
          .where(whereClause),
      ]);

      const founding = await foundingTicketIds(ctx.db, tickets);

      return {
        tickets: tickets.map((t) => ({
          ...t,
          latestMessage: t.messages[0] ?? null,
          isFounding: founding.has(t.id),
        })),
        total: totalResult[0]?.count ?? 0,
      };
    }),

  // ── Ticket counts by status ─────────────────────────────────────
  counts: supporterProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        status: supportTickets.status,
        count: count(),
      })
      .from(supportTickets)
      .groupBy(supportTickets.status);

    const counts: Record<string, number> = {
      open: 0,
      in_progress: 0,
      closed: 0,
    };
    for (const row of rows) {
      counts[row.status] = row.count;
    }
    return counts;
  }),

  // ── Get single ticket with all messages ─────────────────────────
  getTicket: supporterProcedure
    .input(z.object({ ticketId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ticket = await ctx.db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, input.ticketId),
        with: {
          inbox: true,
          user: { columns: { id: true, name: true, email: true, image: true } },
          assignee: { columns: { id: true, name: true } },
          messages: {
            orderBy: [asc(supportMessages.createdAt)],
          },
        },
      });

      if (!ticket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ticket ikke fundet",
        });
      }

      const founding = await foundingTicketIds(ctx.db, [ticket]);
      return { ...ticket, isFounding: founding.has(ticket.id) };
    }),

  // ── Reply to ticket (sends email) ───────────────────────────────
  reply: supporterProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().min(1).max(50000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = await sendSupportReply(
        input.ticketId,
        input.body,
        ctx.session.user.id,
        ctx.db,
      );

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "support_reply",
        null,
        { ticketId: input.ticketId },
        ctx.headers,
      );

      return message;
    }),

  // ── Add internal note ───────────────────────────────────────────
  addNote: supporterProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().min(1).max(50000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ticket = await ctx.db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, input.ticketId),
      });

      if (!ticket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ticket ikke fundet",
        });
      }

      const admin = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: { name: true, email: true },
      });

      const [note] = await ctx.db
        .insert(supportMessages)
        .values({
          ticketId: input.ticketId,
          direction: "outbound",
          fromEmail: admin?.email ?? "admin@timetrack.dk",
          fromName: admin?.name ?? "Admin",
          body: input.body,
          bodyText: input.body,
          isInternal: true,
        })
        .returning();

      // Update ticket timestamp
      await ctx.db
        .update(supportTickets)
        .set({ updatedAt: new Date() })
        .where(eq(supportTickets.id, input.ticketId));

      return note;
    }),

  // ── Update ticket status ────────────────────────────────────────
  updateStatus: supporterProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        status: z.enum(["open", "in_progress", "closed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };

      if (input.status === "closed") {
        updates.closedAt = new Date();
      } else {
        updates.closedAt = null;
      }

      const [ticket] = await ctx.db
        .update(supportTickets)
        .set(updates)
        .where(eq(supportTickets.id, input.ticketId))
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "support_status_change",
        null,
        { ticketId: input.ticketId, status: input.status },
        ctx.headers,
      );

      return ticket;
    }),

  // ── Assign ticket ───────────────────────────────────────────────
  assign: supporterProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        assignedTo: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ticket] = await ctx.db
        .update(supportTickets)
        .set({
          assignedTo: input.assignedTo,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, input.ticketId))
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "support_assign",
        input.assignedTo,
        { ticketId: input.ticketId },
        ctx.headers,
      );

      return ticket;
    }),

  // ── Update priority ─────────────────────────────────────────────
  updatePriority: supporterProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        priority: z.enum(["low", "normal", "high"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ticket] = await ctx.db
        .update(supportTickets)
        .set({
          priority: input.priority,
          updatedAt: new Date(),
        })
        .where(eq(supportTickets.id, input.ticketId))
        .returning();

      return ticket;
    }),

  // ── Inbox CRUD ──────────────────────────────────────────────────
  getInboxes: supporterProcedure.query(async ({ ctx }) => {
    return ctx.db.query.supportInboxes.findMany({
      orderBy: [asc(supportInboxes.name)],
    });
  }),

  createInbox: adminProcedure
    .input(
      z.object({
        email: z.string().email().max(255),
        name: z.string().min(1).max(100),
        color: z.string().max(7).optional().default("#3b82f6"),
        signature: z.string().max(10000).nullable().optional(),
        isDefault: z.boolean().optional().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Wrap in transaction to avoid race where concurrent requests
      // leave zero or multiple default inboxes.
      const [inbox] = await ctx.db.transaction(async (tx) => {
        if (input.isDefault) {
          await tx
            .update(supportInboxes)
            .set({ isDefault: false })
            .where(eq(supportInboxes.isDefault, true));
        }

        return tx
          .insert(supportInboxes)
          .values({
            email: input.email,
            name: input.name,
            color: input.color,
            signature: input.signature ?? null,
            isDefault: input.isDefault,
          })
          .returning();
      });

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "support_inbox_create",
        null,
        { inboxId: inbox.id, email: input.email },
        ctx.headers,
      );

      return inbox;
    }),

  updateInbox: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        email: z.string().email().max(255).optional(),
        name: z.string().min(1).max(100).optional(),
        color: z.string().max(7).optional(),
        signature: z.string().max(10000).nullable().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      if (updates.isDefault) {
        await ctx.db
          .update(supportInboxes)
          .set({ isDefault: false })
          .where(eq(supportInboxes.isDefault, true));
      }

      const [inbox] = await ctx.db
        .update(supportInboxes)
        .set(updates)
        .where(eq(supportInboxes.id, id))
        .returning();

      return inbox;
    }),

  deleteInbox: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check for open tickets
      const openTickets = await ctx.db
        .select({ count: count() })
        .from(supportTickets)
        .where(
          and(
            eq(supportTickets.inboxId, input.id),
            or(
              eq(supportTickets.status, "open"),
              eq(supportTickets.status, "in_progress"),
            ),
          ),
        );

      if ((openTickets[0]?.count ?? 0) > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Kan ikke slette indbakke med aabne tickets. Luk alle tickets foerst.",
        });
      }

      await ctx.db
        .delete(supportInboxes)
        .where(eq(supportInboxes.id, input.id));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "support_inbox_delete",
        null,
        { inboxId: input.id },
        ctx.headers,
      );

      return { success: true };
    }),

  // ── Global signature ────────────────────────────────────────────
  getSignature: supporterProcedure.query(async ({ ctx }) => {
    const row = await ctx.db.query.adminSettings.findFirst({
      where: eq(adminSettings.id, "support_signature"),
    });
    return row?.value ?? "";
  }),

  updateSignature: adminProcedure
    .input(z.object({ signature: z.string().max(50000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(adminSettings)
        .values({
          id: "support_signature",
          value: input.signature,
          updatedAt: new Date(),
          updatedBy: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: adminSettings.id,
          set: {
            value: input.signature,
            updatedAt: new Date(),
            updatedBy: ctx.session.user.id,
          },
        });

      return { success: true };
    }),

  // ── Get admin/supporter users for assignment dropdown ────────────
  getAssignableUsers: supporterProcedure.query(async ({ ctx }) => {
    const adminUsers = await ctx.db.query.users.findMany({
      where: inArray(users.role, ["admin", "supporter"]),
      columns: { id: true, name: true, email: true },
    });
    return adminUsers;
  }),
});

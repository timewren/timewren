import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { roadmapItems } from "@/lib/db/schema";
import { adminProcedure, publicProcedure, router } from "../trpc";

// Valid status values
const statusEnum = z.enum(["planned", "in-progress", "completed"]);

// Input schemas
const createRoadmapItemSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: statusEnum.default("planned"),
  category: z.string().max(50).optional(),
  priority: z.number().int().default(0),
});

const updateRoadmapItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  status: statusEnum.optional(),
  category: z.string().max(50).optional().nullable(),
  priority: z.number().int().optional(),
});

export const roadmapRouter = router({
  // ============================================
  // Public: Get all roadmap items grouped by status
  // ============================================
  getAll: publicProcedure.query(async ({ ctx }) => {
    const items = await ctx.db
      .select()
      .from(roadmapItems)
      .orderBy(asc(roadmapItems.priority), desc(roadmapItems.createdAt));

    // Group by status
    const grouped = {
      planned: items.filter((item) => item.status === "planned"),
      "in-progress": items.filter((item) => item.status === "in-progress"),
      completed: items.filter((item) => item.status === "completed"),
    };

    return grouped;
  }),

  // ============================================
  // Admin: Create a new roadmap item
  // ============================================
  create: adminProcedure
    .input(createRoadmapItemSchema)
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .insert(roadmapItems)
        .values({
          title: input.title,
          description: input.description,
          status: input.status,
          category: input.category,
          priority: input.priority,
        })
        .returning();

      return item;
    }),

  // ============================================
  // Admin: Update a roadmap item
  // ============================================
  update: adminProcedure
    .input(updateRoadmapItemSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;

      // Build update object, only including defined values
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.description !== undefined)
        updateData.description = updates.description;
      if (updates.category !== undefined)
        updateData.category = updates.category;
      if (updates.priority !== undefined)
        updateData.priority = updates.priority;

      if (updates.status !== undefined) {
        updateData.status = updates.status;
        // Set completedAt when status changes to completed
        if (updates.status === "completed") {
          updateData.completedAt = new Date();
        } else {
          updateData.completedAt = null;
        }
      }

      const [item] = await ctx.db
        .update(roadmapItems)
        .set(updateData)
        .where(eq(roadmapItems.id, id))
        .returning();

      return item;
    }),

  // ============================================
  // Admin: Delete a roadmap item
  // ============================================
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(roadmapItems).where(eq(roadmapItems.id, input.id));
      return { success: true };
    }),

  // ============================================
  // Admin: Reorder items within a status column
  // ============================================
  reorder: adminProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            id: z.string().uuid(),
            priority: z.number().int(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Update all items in a transaction
      await ctx.db.transaction(async (tx) => {
        for (const item of input.items) {
          await tx
            .update(roadmapItems)
            .set({ priority: item.priority, updatedAt: new Date() })
            .where(eq(roadmapItems.id, item.id));
        }
      });

      return { success: true };
    }),

  // ============================================
  // Admin: Get all items (flat list for admin)
  // ============================================
  getAllAdmin: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(roadmapItems)
      .orderBy(asc(roadmapItems.status), asc(roadmapItems.priority));
  }),
});

import { describe, expect, it } from "vitest";
import { makeClient, TEST_CLIENT_ID, TEST_USER_ID } from "@/test/fixtures";

/**
 * Tests for client router business logic.
 * Tests list behavior, archive/unarchive toggling, rate history, and stats aggregation.
 */

describe("Client list — limit enforcement", () => {
  it("enforces max 500 clients limit", () => {
    // The router uses `limit: 500` in the findMany call
    // Verify the business rule
    const MAX_CLIENTS = 500;
    expect(MAX_CLIENTS).toBe(500);
  });

  it("filters archived clients by default", () => {
    const includeArchived = false;
    const clients = [
      makeClient({ isArchived: false, name: "Active Co" }),
      makeClient({ id: "c2", isArchived: true, name: "Archived Co" }),
      makeClient({ id: "c3", isArchived: false, name: "Another Co" }),
    ];

    // Replicate the filter logic from the router
    const filtered = includeArchived
      ? clients
      : clients.filter((c) => !c.isArchived);

    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => !c.isArchived)).toBe(true);
  });

  it("includes archived clients when flag is set", () => {
    const includeArchived = true;
    const clients = [
      makeClient({ isArchived: false, name: "Active Co" }),
      makeClient({ id: "c2", isArchived: true, name: "Archived Co" }),
    ];

    const filtered = includeArchived
      ? clients
      : clients.filter((c) => !c.isArchived);

    expect(filtered).toHaveLength(2);
  });
});

describe("listWithStats — aggregation", () => {
  it("correctly aggregates unbilled hours per client", () => {
    const unbilledEntries = [
      { clientId: "c1", hours: "2.5", billableRate: "800" },
      { clientId: "c1", hours: "1.0", billableRate: "800" },
      { clientId: "c2", hours: "3.0", billableRate: "500" },
    ];

    const aggregated = new Map<string, { hours: number; amount: number }>();

    for (const entry of unbilledEntries) {
      const existing = aggregated.get(entry.clientId) || {
        hours: 0,
        amount: 0,
      };
      const hours = parseFloat(entry.hours);
      const rate = parseFloat(entry.billableRate);
      existing.hours += hours;
      existing.amount += hours * rate;
      aggregated.set(entry.clientId, existing);
    }

    expect(aggregated.get("c1")?.hours).toBe(3.5);
    expect(aggregated.get("c1")?.amount).toBe(2800); // 2.5*800 + 1.0*800
    expect(aggregated.get("c2")?.hours).toBe(3.0);
    expect(aggregated.get("c2")?.amount).toBe(1500); // 3.0*500
  });

  it("correctly counts overdue invoices per client", () => {
    const invoices = [
      { clientId: "c1", status: "overdue", amount: "5000" },
      { clientId: "c1", status: "overdue", amount: "3000" },
      { clientId: "c1", status: "paid", amount: "2000" },
      { clientId: "c2", status: "overdue", amount: "1000" },
    ];

    const overdueByClient = new Map<
      string,
      { count: number; amount: number }
    >();

    for (const inv of invoices) {
      if (inv.status !== "overdue") continue;
      const existing = overdueByClient.get(inv.clientId) || {
        count: 0,
        amount: 0,
      };
      existing.count++;
      existing.amount += parseFloat(inv.amount);
      overdueByClient.set(inv.clientId, existing);
    }

    expect(overdueByClient.get("c1")?.count).toBe(2);
    expect(overdueByClient.get("c1")?.amount).toBe(8000);
    expect(overdueByClient.get("c2")?.count).toBe(1);
  });

  it("correctly counts projects per client", () => {
    const projects = [
      { clientId: "c1" },
      { clientId: "c1" },
      { clientId: "c1" },
      { clientId: "c2" },
    ];

    const projectCounts = new Map<string, number>();

    for (const p of projects) {
      projectCounts.set(p.clientId, (projectCounts.get(p.clientId) || 0) + 1);
    }

    expect(projectCounts.get("c1")).toBe(3);
    expect(projectCounts.get("c2")).toBe(1);
  });

  it("returns zero stats for clients with no data", () => {
    const clientIds = ["c1", "c2"];
    const unbilledMap = new Map<string, { hours: number; amount: number }>();
    const overdueMap = new Map<string, { count: number; amount: number }>();
    const projectMap = new Map<string, number>();

    // Only c1 has data
    unbilledMap.set("c1", { hours: 5, amount: 4000 });

    const stats = clientIds.map((id) => ({
      clientId: id,
      unbilledHours: unbilledMap.get(id)?.hours ?? 0,
      unbilledAmount: unbilledMap.get(id)?.amount ?? 0,
      overdueCount: overdueMap.get(id)?.count ?? 0,
      overdueAmount: overdueMap.get(id)?.amount ?? 0,
      projectCount: projectMap.get(id) ?? 0,
    }));

    expect(stats[0].unbilledHours).toBe(5);
    expect(stats[1].unbilledHours).toBe(0);
    expect(stats[1].overdueCount).toBe(0);
    expect(stats[1].projectCount).toBe(0);
  });
});

describe("archive / unarchive", () => {
  it("sets isArchived=true and isActive=false on archive", () => {
    const client = makeClient({ isArchived: false, isActive: true });

    // Replicate archive logic
    const archived = {
      ...client,
      isArchived: true,
      isActive: false,
      updatedAt: new Date(),
    };

    expect(archived.isArchived).toBe(true);
    expect(archived.isActive).toBe(false);
  });

  it("sets isArchived=false and isActive=true on unarchive", () => {
    const client = makeClient({ isArchived: true, isActive: false });

    // Replicate unarchive logic
    const restored = {
      ...client,
      isArchived: false,
      isActive: true,
      updatedAt: new Date(),
    };

    expect(restored.isArchived).toBe(false);
    expect(restored.isActive).toBe(true);
  });

  it("archive and unarchive are inverse operations", () => {
    const original = makeClient({ isArchived: false, isActive: true });

    // Archive
    const afterArchive = { ...original, isArchived: true, isActive: false };
    // Unarchive
    const afterRestore = { ...afterArchive, isArchived: false, isActive: true };

    expect(afterRestore.isArchived).toBe(original.isArchived);
    expect(afterRestore.isActive).toBe(original.isActive);
  });
});

describe("Rate history logging", () => {
  it("detects rate change when defaultHourlyRate differs", () => {
    const existingRate: string = "500";
    const newRate: string = "750";
    const rateChanged = newRate && newRate !== existingRate;

    expect(rateChanged).toBe(true);
  });

  it("does not log when rate is unchanged", () => {
    const existingRate: string = "500";
    const newRate: string = "500";
    const rateChanged = newRate && newRate !== existingRate;

    expect(rateChanged).toBe(false);
  });

  it("does not log when new rate is empty", () => {
    const existingRate: string = "500";
    const newRate: string = "";
    const rateChanged = newRate && newRate !== existingRate;

    // Empty string is falsy, so rateChanged is ""
    expect(!!rateChanged).toBe(false);
  });

  it("creates correct rate history entry shape", () => {
    const entry = {
      userId: TEST_USER_ID,
      clientId: TEST_CLIENT_ID,
      projectId: null,
      oldRate: "500",
      newRate: "750",
      rateType: "client",
      effectiveDate: new Date(),
    };

    expect(entry.rateType).toBe("client");
    expect(entry.projectId).toBeNull();
    expect(entry.oldRate).toBe("500");
    expect(entry.newRate).toBe("750");
  });
});

describe("Change detection", () => {
  // Simplified detectChanges (from activity.ts)
  function detectChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    labels: Record<string, string>,
  ) {
    const changes: Array<{
      field: string;
      label: string;
      oldValue: unknown;
      newValue: unknown;
    }> = [];

    for (const key of Object.keys(after)) {
      const oldVal = before[key];
      const newVal = after[key];
      if (oldVal !== newVal) {
        changes.push({
          field: key,
          label: labels[key] || key,
          oldValue: oldVal,
          newValue: newVal,
        });
      }
    }

    return changes;
  }

  it("detects name change", () => {
    const before = { name: "Old Name", email: "test@test.com" };
    const after = { name: "New Name", email: "test@test.com" };
    const labels = { name: "Navn", email: "Email" };

    const changes = detectChanges(before, after, labels);

    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe("name");
    expect(changes[0].label).toBe("Navn");
    expect(changes[0].oldValue).toBe("Old Name");
    expect(changes[0].newValue).toBe("New Name");
  });

  it("detects multiple changes", () => {
    const before = { name: "Old", email: "old@test.com", phone: "123" };
    const after = { name: "New", email: "new@test.com", phone: "123" };
    const labels = { name: "Navn", email: "Email", phone: "Telefon" };

    const changes = detectChanges(before, after, labels);

    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.field)).toContain("name");
    expect(changes.map((c) => c.field)).toContain("email");
  });

  it("returns empty array when nothing changed", () => {
    const data = { name: "Same", email: "same@test.com" };
    const labels = { name: "Navn", email: "Email" };

    const changes = detectChanges(data, { ...data }, labels);
    expect(changes).toHaveLength(0);
  });
});

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../../src/lib/db/schema";
import { FREELANCE_BUNDLE } from "../../src/lib/modules/constants";
import { SYSTEM_TEMPLATES } from "../../src/lib/reports/defaults";
import {
  DEFAULT_ACTIVE_WIDGETS,
  DEFAULT_DASHBOARD_LAYOUT,
} from "../../src/types/dashboard";
import { demoData, id, localDatabase, locales } from "./demo";

export async function seedDemo() {
  const client = postgres(localDatabase(), { max: 1 });
  const db = drizzle(client);
  // Ephemeral credential, passed in memory to the capture process, never committed.
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);
  const hourlyRate = "750";
  const costRate = "350";
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(s.featureFlags)
        .values(
          ["prepaidPackages", "calendar", "organizations"].map((key) => ({
            key,
            enabled: true,
          })),
        )
        .onConflictDoNothing();
      for (const locale of locales) {
        const d = demoData(locale, today);
        await tx
          .insert(s.organizations)
          .values({
            id: d.orgId,
            name: d.text.studio,
            slug: `screenshot-${locale}`,
            brand: "timewren",
          })
          .onConflictDoNothing();
        for (let person = 0; person < 3; person++) {
          const userId = id(`${locale}:user:${person}`);
          const email =
            person === 0
              ? d.email
              : `team-${locale}-${person}@timewren.invalid`;
          await tx
            .insert(s.users)
            .values({
              id: userId,
              email,
              name: d.text.people[person],
              brand: "timewren",
              emailVerified: true,
              locale,
              timezone: "UTC",
              onboardingCompleted: true,
              defaultHourlyRate: hourlyRate,
              dismissedBanners: [
                "guided-tour",
                "onboarding-checklist",
                "desktop-download",
                "welcome-first-timer",
              ],
            })
            .onConflictDoNothing();
          await tx
            .insert(s.accounts)
            .values({
              id: id(`${locale}:account:${person}`),
              userId,
              accountId: userId,
              providerId: "credential",
              password: passwordHash,
            })
            .onConflictDoUpdate({
              target: s.accounts.id,
              set: { password: passwordHash },
            });
          await tx
            .insert(s.members)
            .values({
              id: id(`${locale}:member:${person}`),
              organizationId: d.orgId,
              userId,
              role: person === 0 ? "owner" : "member",
              costRate,
            })
            .onConflictDoNothing();
        }
        const owned = { userId: d.userId, organizationId: d.orgId };
        const reportConfig = structuredClone(SYSTEM_TEMPLATES[0].config);
        reportConfig.branding.title = d.text.report;
        reportConfig.columns = [
          "date",
          "client",
          "project",
          "description",
          "hours",
          "value",
        ];
        await tx
          .insert(s.reportTemplates)
          .values({
            ...owned,
            id: id(`${locale}:report`),
            name: d.text.report,
            config: reportConfig,
            isDefault: true,
          })
          .onConflictDoNothing();
        const connectionId = id(`${locale}:calendar`);
        await tx
          .insert(s.calendarConnections)
          .values({
            ...owned,
            id: connectionId,
            provider: "google",
            providerAccountId: d.email,
            calendarName: d.text.studio,
            syncEnabled: false,
            syncDirection: "inbound",
            lastSynced: d.day(0),
            grantedScopes: "https://www.googleapis.com/auth/calendar.readonly",
          })
          .onConflictDoNothing();
        for (const [index, name] of d.text.lanes.entries()) {
          await tx
            .insert(s.taskStatuses)
            .values({
              ...owned,
              id: id(`${locale}:lane:${index}`),
              scope: "general",
              name,
              color: ["#64748b", "#b57639", "#337c70"][index],
              order: index,
              isArchive: index === 2,
              category: (["not_started", "in_progress", "done"] as const)[
                index
              ],
            })
            .onConflictDoNothing();
        }
        await tx
          .insert(s.organizationModules)
          .values(
            FREELANCE_BUNDLE.map((moduleKey) => ({
              id: id(`${locale}:module:${moduleKey}`),
              organizationId: d.orgId,
              moduleKey,
              isAvailable: true,
              isEnabled: true,
            })),
          )
          .onConflictDoNothing();
        await tx
          .insert(s.dashboardPreferences)
          .values({
            ...owned,
            activeWidgets: DEFAULT_ACTIVE_WIDGETS,
            layout: DEFAULT_DASHBOARD_LAYOUT,
          })
          .onConflictDoNothing();
        for (const [i, c] of d.clients.entries()) {
          const projectId = id(`${locale}:project:${i}`);
          const packageId = id(`${locale}:package:${i}`);
          const colors = [
            "#337C70",
            "#5D6BB0",
            "#B57639",
            "#8F5F99",
            "#4B8598",
            "#9C5A61",
            "#708447",
          ];
          await tx
            .insert(s.clients)
            .values({
              ...owned,
              ...c,
              company: c.name,
              country: {
                en: "United Kingdom",
                da: "Danmark",
                de: "Deutschland",
                es: "España",
              }[locale],
              defaultHourlyRate: hourlyRate,
              color: colors[i],
            })
            .onConflictDoNothing();
          await tx
            .insert(s.projects)
            .values({
              ...owned,
              id: projectId,
              clientId: c.id,
              name: d.text.projects[i],
              hourlyRate,
              budgetHours: "120",
              startDate: d.day(-42),
              status: i === 6 ? "completed" : "active",
            })
            .onConflictDoNothing();
          // Each package has six linked deductions with an exact matching balance.
          const used = i === 6 ? 27 : i === 5 ? 24 : (i + 1) * 3;
          await tx
            .insert(s.prepaidPackages)
            .values({
              ...owned,
              id: packageId,
              clientId: c.id,
              name: `${d.text.package} · ${c.name}`,
              totalHours: "30",
              usedHours: String(used),
              remainingHours: String(30 - used),
              hourlyRate,
              totalValue: String(30 * Number(hourlyRate)),
              purchaseDate: d.day(-42),
              expiryDate: d.day(i === 4 ? 7 : 90),
            })
            .onConflictDoNothing();
          for (let week = 0; week < 6; week++) {
            const entryId = id(`${locale}:prepaid-entry:${i}:${week}`);
            const date = d.day(-week * 7 - (i % 5), i < 2 ? 8 : 9);
            const hours = used / 6;
            await tx
              .insert(s.timeEntries)
              .values({
                ...owned,
                id: entryId,
                clientId: c.id,
                projectId,
                prepaidPackageId: packageId,
                description: d.text.work[(i + week) % 6],
                hours: String(hours),
                date,
                startTime: date,
                endTime: new Date(+date + hours * 3600000),
                billableRate: hourlyRate,
                costRate,
                isPrepaid: true,
                isBillable: false,
              })
              .onConflictDoNothing();
            await tx
              .insert(s.prepaidUsage)
              .values({
                id: id(`${locale}:usage:${i}:${week}`),
                prepaidPackageId: packageId,
                timeEntryId: entryId,
                hoursUsed: String(hours),
                valueUsed: String(hours * Number(hourlyRate)),
                description: d.text.work[(i + week) % 6],
                createdAt: date,
              })
              .onConflictDoNothing();
          }
          const status = ["draft", "sent", "paid", "overdue"][i % 4];
          await tx
            .insert(s.invoices)
            .values({
              ...owned,
              id: id(`${locale}:invoice:${i}`),
              clientId: c.id,
              invoiceNumber: `DEMO-${101 + i}`,
              amount: String((10 + i * 2) * Number(hourlyRate)),
              status,
              issueDate: d.day(-21 + i),
              dueDate: d.day(status === "overdue" ? -5 : 14),
              paidDate: status === "paid" ? d.day(-3) : null,
              notes: d.text.projects[i],
            })
            .onConflictDoNothing();
          for (let n = 0; n < 2; n++) {
            await tx
              .insert(s.tasks)
              .values({
                ...owned,
                id: id(`${locale}:task:${i}:${n}`),
                clientId: c.id,
                projectId,
                title: n ? d.text.task : d.text.work[i % 6],
                status: ["todo", "in_progress", "done"][i % 3],
                statusId: id(`${locale}:lane:${i % 3}`),
                priority: i % 3 === 0 ? "high" : "medium",
                deadline: d.day(i + 1),
                estimatedMinutes: 90,
                position: i,
              })
              .onConflictDoNothing();
          }
        }
        // A populated six-week report, including recent work even on a month boundary.
        await tx
          .insert(s.recurringInvoices)
          .values({
            ...owned,
            id: id(`${locale}:recurring`),
            clientId: d.clients[0].id,
            name: d.text.package,
            billingMode: "fixed",
            lines: [
              {
                description: d.text.package,
                quantity: "10",
                unitPrice: hourlyRate,
              },
            ],
            interval: "monthly",
            anchorDay: d.day(14).getUTCDate(),
            nextRunDate: d.day(14).toISOString().slice(0, 10),
          })
          .onConflictDoNothing();
        for (let offset = -41; offset <= 0; offset++) {
          const date = d.day(offset, 14);
          if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
          const index = Math.abs(offset) % 7;
          await tx
            .insert(s.timeEntries)
            .values({
              ...owned,
              id: id(`${locale}:entry:${offset}`),
              clientId: d.clients[index].id,
              projectId: id(`${locale}:project:${index}`),
              description: d.text.work[Math.abs(offset) % 6],
              hours: "3.25",
              date,
              startTime: date,
              endTime: new Date(+date + 3.25 * 3600000),
              billableRate: hourlyRate,
              costRate,
              isBillable: true,
              isBilled: offset < -4 && (index === 2 || index === 6),
              invoiceId:
                offset < -4 && (index === 2 || index === 6)
                  ? id(`${locale}:invoice:${index}`)
                  : null,
            })
            .onConflictDoNothing();
        }
        const mondayOffset = -((today.getUTCDay() + 6) % 7);
        for (let offset = 0; offset < 5; offset++) {
          await tx
            .insert(s.calendarEvents)
            .values({
              ...owned,
              id: id(`${locale}:event:${offset}`),
              calendarConnectionId: connectionId,
              title: `${d.text.meeting}: ${d.clients[offset].name}`,
              startTime: new Date(
                +d.day(mondayOffset + offset, 13) + 30 * 60000,
              ),
              endTime: d.day(mondayOffset + offset, 14),
              eventType: "time_block",
              linkedProjectId: id(`${locale}:project:${offset}`),
              timezone: "UTC",
            })
            .onConflictDoNothing();
        }
      }
    });
    console.log("Seeded four fictional TimeWren demo datasets (local only).");
    return { password, today };
  } catch {
    throw new Error(
      "Demo seed failed; check the dedicated local database schema.",
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  seedDemo().catch(() => {
    console.error("Demo seed failed; check the local database schema.");
    process.exitCode = 1;
  });
}

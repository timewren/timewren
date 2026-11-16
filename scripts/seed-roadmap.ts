import { db } from "../src/lib/db";
import { roadmapItems } from "../src/lib/db/schema";

const items = [
  // In Progress (priority 1-3 = højest)
  {
    title: "Mobile app (iOS & Android)",
    description:
      "Native mobile app med timer, tidsregistrering og push notifications. React Native med offline support.",
    status: "in-progress",
    category: "mobile",
    priority: 1,
  },
  {
    title: "Outlook Calendar sync",
    description:
      "Integration med Microsoft Outlook/365 kalender. Synkroniser events og bloker tid automatisk.",
    status: "in-progress",
    category: "integration",
    priority: 2,
  },

  // Planned - High Priority
  {
    title: "Slack integration",
    description:
      "Start/stop timer fra Slack. Daily standups med gårsdagens tidsregistreringer. Slash commands.",
    status: "planned",
    category: "integration",
    priority: 1,
  },
  {
    title: "AI-powered time suggestions",
    description:
      "Machine learning der foreslår projekter baseret på din kalender, emails og arbejdsmønstre.",
    status: "planned",
    category: "feature",
    priority: 2,
  },
  {
    title: "Automatisk fakturering",
    description:
      "Generer og send fakturaer automatisk ved månedens udgang eller når klippekort er opbrugt.",
    status: "planned",
    category: "feature",
    priority: 3,
  },
  {
    title: "Team dashboard",
    description:
      "Overblik over dit teams tidsregistreringer, projektstatus og kapacitet. Resource planning.",
    status: "planned",
    category: "feature",
    priority: 4,
  },
  {
    title: "Pomodoro timer mode",
    description:
      "25/5 min arbejds/pause-intervaller. Statistik over fokustid. Integration med eksisterende timer.",
    status: "planned",
    category: "improvement",
    priority: 5,
  },
  {
    title: "API for third-party integrations",
    description:
      "Public REST API med API keys, rate limiting og webhooks. Dokumentation med OpenAPI/Swagger.",
    status: "planned",
    category: "integration",
    priority: 6,
  },
  {
    title: "Bulk time entry",
    description:
      "Opret mange tidsregistreringer på én gang. Kopier uger, templates og batch-redigering.",
    status: "planned",
    category: "improvement",
    priority: 7,
  },
  {
    title: "Budget alerts",
    description:
      "Advarsler når projekter nærmer sig budgetgrænsen. Email og push notifications.",
    status: "planned",
    category: "feature",
    priority: 8,
  },
  {
    title: "Custom reports builder",
    description:
      "Byg dine egne rapporter med drag-and-drop. Eksport til PDF, Excel og CSV.",
    status: "planned",
    category: "feature",
    priority: 9,
  },
  {
    title: "Multi-currency support",
    description:
      "Arbejd med flere valutaer. Automatisk kursomregning og valuta per kunde/projekt.",
    status: "planned",
    category: "feature",
    priority: 10,
  },

  // Completed
  {
    title: "Google Calendar integration",
    description:
      "Synkroniser med Google Calendar. Time-blocking og event-to-task linking.",
    status: "completed",
    category: "integration",
    priority: 1,
    completedAt: new Date("2026-01-15"),
  },
  {
    title: "Browser extension",
    description:
      "Chrome og Firefox extension med timer, auto-detection og offline support.",
    status: "completed",
    category: "feature",
    priority: 2,
    completedAt: new Date("2026-01-20"),
  },
  {
    title: "Client portal (white-label)",
    description:
      "Giv kunder adgang til deres egne data med dit brand. Fakturaer, tid og klippekort.",
    status: "completed",
    category: "feature",
    priority: 3,
    completedAt: new Date("2026-01-25"),
  },
];

async function seed() {
  console.log("🌱 Seeding roadmap items...");

  for (const item of items) {
    await db.insert(roadmapItems).values(item);
    console.log(`  ✓ ${item.title}`);
  }

  console.log(`\n✅ Added ${items.length} roadmap items!`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Error seeding:", err);
  process.exit(1);
});

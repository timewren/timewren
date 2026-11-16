import { randomUUID } from "node:crypto";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import * as dotenv from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Load .env.local in development
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const databaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/freelance_crm";

// --- Password hashing (matches better-auth's scrypt format) ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(saltBytes);
  const key = await scryptAsync(password.normalize("NFKC"), saltHex, {
    N: 16384,
    r: 16,
    p: 1,
    dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2,
  });
  return `${saltHex}:${bytesToHex(key)}`;
}

// --- Helpers ---

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function nowISO(): string {
  return new Date().toISOString();
}

function generateId(): string {
  // Better-Auth uses nanoid-style text IDs for users/accounts
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

// --- Main ---

async function main() {
  console.log("🌱 Running database seed...");

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    // ─── Check if users already exist ───
    const existingAdmin = await db.execute(
      sql`SELECT id FROM "user" WHERE email = 'admin@timetrack.dk' LIMIT 1`,
    );
    const existingFreelancer = await db.execute(
      sql`SELECT id FROM "user" WHERE email = 'freelancer@test.dk' LIMIT 1`,
    );

    if (existingAdmin.length > 0 && existingFreelancer.length > 0) {
      console.log("✅ Seed data already exists, skipping.");
      return;
    }

    // ─── Hash passwords ───
    console.log("🔑 Hashing passwords...");
    const adminPasswordHash = await hashPassword("admin123");
    const freelancerPasswordHash = await hashPassword("test123");

    const now = nowISO();

    // ─── Admin user ───
    const adminId = generateId();
    const adminAccountId = generateId();

    if (existingAdmin.length === 0) {
      console.log("👤 Creating admin user...");
      await db.execute(sql`
        INSERT INTO "user" (id, email, "emailVerified", name, default_hourly_rate, onboarding_completed, role, "createdAt", "updatedAt")
        VALUES (${adminId}, 'admin@timetrack.dk', true, 'Admin', '850.00', true, 'admin', ${now}, ${now})
      `);
      await db.execute(sql`
        INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
        VALUES (${adminAccountId}, ${adminId}, 'admin@timetrack.dk', 'credential', ${adminPasswordHash}, ${now}, ${now})
      `);
      // Email preferences for admin
      await db.execute(sql`
        INSERT INTO email_preferences (id, user_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${adminId}, ${now}, ${now})
      `);
      console.log("  ✅ admin@timetrack.dk / admin123");
    }

    // ─── Freelancer user ───
    const freelancerId = generateId();
    const freelancerAccountId = generateId();

    if (existingFreelancer.length === 0) {
      console.log("👤 Creating freelancer user...");
      await db.execute(sql`
        INSERT INTO "user" (id, email, "emailVerified", name, default_hourly_rate, onboarding_completed, role, "createdAt", "updatedAt")
        VALUES (${freelancerId}, 'freelancer@test.dk', true, 'Test Freelancer', '750.00', true, 'user', ${now}, ${now})
      `);
      await db.execute(sql`
        INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
        VALUES (${freelancerAccountId}, ${freelancerId}, 'freelancer@test.dk', 'credential', ${freelancerPasswordHash}, ${now}, ${now})
      `);
      // Email preferences for freelancer
      await db.execute(sql`
        INSERT INTO email_preferences (id, user_id, created_at, updated_at)
        VALUES (${randomUUID()}, ${freelancerId}, ${now}, ${now})
      `);
      console.log("  ✅ freelancer@test.dk / test123");

      // ─── Clients ───
      console.log("🏢 Creating clients...");
      const acmeId = randomUUID();
      const nordicId = randomUUID();

      await db.execute(sql`
        INSERT INTO clients (id, name, email, company, cvr_number, user_id, default_hourly_rate, city, postal_code, country, created_at, updated_at)
        VALUES
          (${acmeId}, 'Acme ApS', 'kontakt@acme.dk', 'Acme ApS', '12345678', ${freelancerId}, '900.00', 'København', '1000', 'Danmark', ${now}, ${now}),
          (${nordicId}, 'Nordic Digital A/S', 'info@nordicdigital.dk', 'Nordic Digital A/S', '87654321', ${freelancerId}, '850.00', 'Aarhus', '8000', 'Danmark', ${now}, ${now})
      `);
      console.log("  ✅ Acme ApS, Nordic Digital A/S");

      // ─── Projects ───
      console.log("📁 Creating projects...");
      const websiteProjectId = randomUUID();
      const appProjectId = randomUUID();

      await db.execute(sql`
        INSERT INTO projects (id, name, description, client_id, user_id, hourly_rate, status, start_date, created_at, updated_at)
        VALUES
          (${websiteProjectId}, 'Website Redesign', 'Komplet redesign af virksomhedswebsite med nyt CMS', ${acmeId}, ${freelancerId}, '900.00', 'active', ${daysAgo(30)}, ${now}, ${now}),
          (${appProjectId}, 'App Udvikling', 'Mobilapp til kundeportal med React Native', ${nordicId}, ${freelancerId}, '850.00', 'active', ${daysAgo(14)}, ${now}, ${now})
      `);
      console.log("  ✅ Website Redesign, App Udvikling");

      // ─── Time entries ───
      console.log("⏱️  Creating time entries...");
      const timeEntryIds = Array.from({ length: 8 }, () => randomUUID());

      // Spread over last 2 weeks, mix of billable/non-billable
      await db.execute(sql`
        INSERT INTO time_entries (id, project_id, client_id, user_id, description, hours, date, billable_rate, is_billable, source, created_at, updated_at)
        VALUES
          (${timeEntryIds[0]}, ${websiteProjectId}, ${acmeId}, ${freelancerId}, 'Wireframes og mockups i Figma', '3.50', ${daysAgo(13)}, '900.00', true, 'manual', ${now}, ${now}),
          (${timeEntryIds[1]}, ${websiteProjectId}, ${acmeId}, ${freelancerId}, 'Frontend-implementering af header og navigation', '5.00', ${daysAgo(11)}, '900.00', true, 'manual', ${now}, ${now}),
          (${timeEntryIds[2]}, ${websiteProjectId}, ${acmeId}, ${freelancerId}, 'Intern research af CMS-løsninger', '2.00', ${daysAgo(9)}, null, false, 'manual', ${now}, ${now}),
          (${timeEntryIds[3]}, ${websiteProjectId}, ${acmeId}, ${freelancerId}, 'Responsive design og test', '4.00', ${daysAgo(6)}, '900.00', true, 'timer', ${now}, ${now}),
          (${timeEntryIds[4]}, ${appProjectId}, ${nordicId}, ${freelancerId}, 'Projektopsætning og arkitektur', '3.00', ${daysAgo(10)}, '850.00', true, 'manual', ${now}, ${now}),
          (${timeEntryIds[5]}, ${appProjectId}, ${nordicId}, ${freelancerId}, 'Login-flow og authentication', '6.00', ${daysAgo(7)}, '850.00', true, 'timer', ${now}, ${now}),
          (${timeEntryIds[6]}, ${appProjectId}, ${nordicId}, ${freelancerId}, 'API-integration og datalag', '4.50', ${daysAgo(3)}, '850.00', true, 'manual', ${now}, ${now}),
          (${timeEntryIds[7]}, ${appProjectId}, ${nordicId}, ${freelancerId}, 'Kodereview og refaktorering', '1.50', ${daysAgo(1)}, null, false, 'manual', ${now}, ${now})
      `);
      console.log("  ✅ 8 time entries (6 billable, 2 non-billable)");

      // ─── Tasks ───
      console.log("📋 Creating tasks...");
      await db.execute(sql`
        INSERT INTO tasks (id, user_id, title, description, project_id, client_id, status, priority, position, created_at, updated_at)
        VALUES
          (${randomUUID()}, ${freelancerId}, 'Implementér kontaktformular', 'Kontaktformular med validering og email-afsendelse', ${websiteProjectId}, ${acmeId}, 'backlog', 'medium', 0, ${now}, ${now}),
          (${randomUUID()}, ${freelancerId}, 'Push notifications', 'Implementér push notifications til mobilappen', ${appProjectId}, ${nordicId}, 'in_progress', 'high', 0, ${now}, ${now}),
          (${randomUUID()}, ${freelancerId}, 'Opsæt CI/CD pipeline', 'GitHub Actions til automatisk deploy', ${appProjectId}, ${nordicId}, 'done', 'medium', 0, ${daysAgo(5)}, ${now})
      `);
      console.log("  ✅ 3 tasks (backlog, in_progress, done)");

      // ─── Invoice (draft) ───
      console.log("📄 Creating draft invoice...");
      const invoiceId = randomUUID();
      const invoiceTotal = "11250.00"; // (3.5 + 5.0 + 4.0) * 900 = 11250

      await db.execute(sql`
        INSERT INTO invoices (id, invoice_number, client_id, user_id, amount, status, issue_date, due_date, notes, created_at, updated_at)
        VALUES (${invoiceId}, 'INV-2026-001', ${acmeId}, ${freelancerId}, ${invoiceTotal}, 'draft', ${now}, ${daysAgo(-14)}, 'Website Redesign - februar 2026', ${now}, ${now})
      `);

      // Invoice lines
      await db.execute(sql`
        INSERT INTO invoice_lines (id, invoice_id, description, quantity, unit_price, amount, time_entry_id, sort_order, created_at)
        VALUES
          (${randomUUID()}, ${invoiceId}, 'Wireframes og mockups i Figma', '3.50', '900.00', '3150.00', ${timeEntryIds[0]}, 0, ${now}),
          (${randomUUID()}, ${invoiceId}, 'Frontend-implementering af header og navigation', '5.00', '900.00', '4500.00', ${timeEntryIds[1]}, 1, ${now}),
          (${randomUUID()}, ${invoiceId}, 'Responsive design og test', '4.00', '900.00', '3600.00', ${timeEntryIds[3]}, 2, ${now})
      `);
      console.log("  ✅ Invoice INV-2026-001 (draft, 11.250 DKK)");
    }

    console.log("");
    console.log("🎉 Seed complete!");
    console.log("");
    console.log("  Logins:");
    console.log("  ─────────────────────────────────────────");
    console.log("  Admin:      admin@timetrack.dk / admin123");
    console.log("  Freelancer: freelancer@test.dk / test123");
    console.log("");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { cleanupExpiredDemoUsers } from "@/lib/demo/cleanup";
import { isDemoMode } from "@/lib/demo/demo-mode";

// Offentlig demo (DEMO_MODE=1, docs/demo.md): sletter demokonti ældre end 24
// timer med organisation og alle data. Kører hver time. Uden demo-tilstand en
// no-op, der hverken læser eller sletter noget.
export const GET = withCronLogging("demo-cleanup", async () => {
  if (!isDemoMode()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "demo-mode-off" },
    };
  }
  const result = await cleanupExpiredDemoUsers(db);
  return {
    itemsProcessed: result.found,
    itemsSucceeded: result.deleted,
    itemsFailed: result.failed,
  };
});

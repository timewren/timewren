import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clients, users } from "@/lib/db/schema";

/**
 * Check if a user has completed onboarding
 * User is considered onboarded if they have:
 * 1. A name set in their profile
 * 2. At least one client created (optional but recommended)
 */
export async function isUserOnboarded(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true },
  });
  return !!user?.name;
}

/**
 * Check if user needs to be redirected to onboarding
 */
export async function shouldRedirectToOnboarding(
  userId: string,
  currentPath: string,
): Promise<boolean> {
  // Don't redirect if already on onboarding page or auth pages
  if (
    currentPath.startsWith("/dashboard/onboarding") ||
    currentPath.startsWith("/auth") ||
    currentPath.startsWith("/login") ||
    currentPath.startsWith("/api")
  ) {
    return false;
  }

  const onboarded = await isUserOnboarded(userId);
  return !onboarded;
}

/**
 * Get onboarding progress for a user
 */
export async function getOnboardingProgress(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { name: true, defaultHourlyRate: true },
  });

  const hasClient = await db.query.clients.findFirst({
    where: eq(clients.userId, userId),
    columns: { id: true },
  });

  return {
    hasName: !!user?.name,
    hasDefaultRate: !!user?.defaultHourlyRate,
    hasClients: !!hasClient,
    isComplete: !!user?.name,
  };
}

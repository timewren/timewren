"use client";

import { useEffect, useMemo } from "react";
import { useSession } from "@/lib/auth-client";

/**
 * Sticky pr.-browser-hint om, hvorvidt brugeren sidst var en enterprise-
 * medarbejder (member/manager i enterprise-profil). Bruges til at træffe
 * UI-beslutninger (timer-bar, dashboard-hold) FØR orgProfile+rolle er
 * indlæst, så betalende freelancere aldrig mister UI under load, og en kendt
 * enterprise-medarbejder får det skjult fra første paint.
 *
 * Nøglen er scopet pr. bruger (#452), så en delt browser aldrig arver en
 * anden brugers hint. Ukendt bruger ⇒ ingen hint.
 *
 * "1" = enterprise-medarbejder, "0" = ikke, null = ukendt.
 */
export const ENTERPRISE_MEMBER_HINT_KEY_PREFIX = "tt:enterpriseMember";

export function enterpriseMemberHintKey(userId: string): string {
  return `${ENTERPRISE_MEMBER_HINT_KEY_PREFIX}:${userId}`;
}

function readHint(userId: string | undefined): string | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    return window.localStorage.getItem(enterpriseMemberHintKey(userId));
  } catch {
    return null;
  }
}

/** Læser hinten for den aktuelle bruger (dashboardet renderer efter session). */
export function useEnterpriseMemberHint(): string | null {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  return useMemo(() => readHint(userId), [userId]);
}

/** Gemmer den rigtige beslutning, når orgProfile+rolle er kendt. */
export function usePersistEnterpriseMemberHint(
  resolved: boolean,
  isMember: boolean,
) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  useEffect(() => {
    if (!resolved || !userId) return;
    try {
      window.localStorage.setItem(
        enterpriseMemberHintKey(userId),
        isMember ? "1" : "0",
      );
    } catch {
      // localStorage utilgængelig — hinten er kun en optimering
    }
  }, [resolved, isMember, userId]);
}

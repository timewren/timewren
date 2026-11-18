"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useState } from "react";

const TestAccountContext = createContext(false);

export function useIncludeTestAccounts() {
  return useContext(TestAccountContext);
}

export function TestAccountFilter({ children }: { children: ReactNode }) {
  const t = useTranslations("adminShell");
  const pathname = usePathname();
  const [includeTestAccounts, setIncludeTestAccounts] = useState(false);
  const showFilter = [
    "/admin",
    "/admin/analytics",
    "/admin/analytics/retention",
    "/admin/finance",
    "/admin/growth",
    "/admin/users",
    "/admin/scenarios",
    "/admin/desktop",
    "/admin/onboarding-funnel",
    "/admin/prospects",
  ].includes(pathname);

  return (
    <TestAccountContext.Provider value={includeTestAccounts}>
      {showFilter && (
        <label className="mb-4 flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={includeTestAccounts}
            onChange={(event) => setIncludeTestAccounts(event.target.checked)}
          />
          {t("includeTestAccounts")}
        </label>
      )}
      {children}
    </TestAccountContext.Provider>
  );
}

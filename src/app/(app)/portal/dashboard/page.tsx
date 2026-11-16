"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getPortalPath, useCustomDomain } from "@/hooks/useCustomDomain";
import { PortalDashboard } from "../_components/PortalDashboard";
import { PortalLoading } from "../_components/PortalShell";

export default function PortalDashboardPage() {
  const router = useRouter();
  const { isCustomDomain } = useCustomDomain();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("portalSession");
    if (token) {
      setSessionToken(token);
    } else {
      router.push(getPortalPath("/portal/login", isCustomDomain));
    }
    setIsLoading(false);
  }, [router, isCustomDomain]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <PortalLoading />
      </div>
    );
  }

  if (!sessionToken) {
    return null;
  }

  // useSearchParams (fanen i URL'en) kræver en Suspense-grænse ved prerender.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
          <PortalLoading />
        </div>
      }
    >
      <PortalDashboard sessionToken={sessionToken} />
    </Suspense>
  );
}

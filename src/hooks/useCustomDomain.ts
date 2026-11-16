"use client";

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc-provider";

const PRIMARY_DOMAINS = new Set([
  "timetrack.dk",
  "www.timetrack.dk",
  "localhost",
]);

export function useCustomDomain() {
  const [hostname, setHostname] = useState<string>("");

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  const isCustomDomain = useMemo(() => {
    if (!hostname) return false;
    return !PRIMARY_DOMAINS.has(hostname);
  }, [hostname]);

  const { data: branding, isLoading: brandingLoading } =
    trpc.publicPortal.getBrandingByDomain.useQuery(
      { domain: hostname },
      { enabled: isCustomDomain && !!hostname },
    );

  return {
    isCustomDomain,
    hostname,
    branding: isCustomDomain ? branding : null,
    brandingLoading: isCustomDomain ? brandingLoading : false,
    freelancerUserId: branding?.userId ?? null,
  };
}

/**
 * Returns the correct path for portal navigation.
 * On custom domains, strips the /portal prefix so URLs look clean.
 * On the main domain, keeps the /portal prefix.
 */
export function getPortalPath(path: string, isCustomDomain: boolean): string {
  if (isCustomDomain) {
    // Strip /portal prefix for clean URLs on custom domains
    return path.replace(/^\/portal/, "") || "/";
  }
  // Ensure /portal prefix on main domain
  if (!path.startsWith("/portal")) {
    return `/portal${path}`;
  }
  return path;
}

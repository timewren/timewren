"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePlausible } from "next-plausible";
import { Suspense, useEffect, useRef } from "react";

/**
 * Fyrer signup-konverteringen for OAuth-signups. Email-flowet tracker på
 * /register, men OAuth redirecter direkte til dashboardet — nye
 * OAuth-brugere lander derfor med ?signup=oauth (newUserCallbackURL i
 * SocialAuthButtons) og trackes her. Parametret fjernes fra URL'en efter
 * første fyring så en reload ikke dobbelt-tæller.
 */
function OAuthSignupTrackerInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const plausible = usePlausible();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (searchParams.get("signup") !== "oauth") return;
    fired.current = true;

    plausible("signup_completed", { props: { method: "oauth" } });
    import("@/components/GoogleAds").then(({ trackGoogleConversion }) => {
      trackGoogleConversion("signup");
    });

    const params = new URLSearchParams(searchParams.toString());
    params.delete("signup");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [searchParams, pathname, router, plausible]);

  return null;
}

export function OAuthSignupTracker() {
  // useSearchParams kræver en Suspense-boundary på statisk renderede sider.
  return (
    <Suspense fallback={null}>
      <OAuthSignupTrackerInner />
    </Suspense>
  );
}

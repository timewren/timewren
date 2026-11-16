"use client";

import { Loader2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  clearPortalSessions,
  PORTAL_SESSION_KEY,
  portalSessionKey,
} from "@/lib/portal/session-key";
import { trpc } from "@/providers/trpc-provider";
import { PortalDashboard } from "../../_components/PortalDashboard";

export default function TokenPortalPage() {
  const t = useTranslations("portal.token");
  const params = useParams();
  const token = params.token as string;
  const hasValidated = useRef(false);

  // Sessionen gemmes under en nøgle scopet til selve token'et. Den generiske
  // nøgle er delt for hele browseren, så uden scoping ville et link til kunde
  // B genbruge en session for kunde A. null = blankt token ⇒ ingen session at
  // genbruge, og aldrig fallback til den generiske nøgle.
  const storageKey = portalSessionKey(token);

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isValidatingExisting, setIsValidatingExisting] = useState(true);
  const [existingSessionToken, setExistingSessionToken] = useState<
    string | null
  >(null);
  const [hasReadStorage, setHasReadStorage] = useState(false);

  // Validate token and create session
  const validateMutation = trpc.publicPortal.validateToken.useMutation({
    onSuccess: (data) => {
      setSessionToken(data.sessionToken);
      // Scopet nøgle: kun dette token må genbruge sessionen.
      if (storageKey) localStorage.setItem(storageKey, data.sessionToken);
      // Generisk nøgle: de øvrige portalsider kender kun den.
      localStorage.setItem(PORTAL_SESSION_KEY, data.sessionToken);
    },
    onError: (err) => {
      // Ugyldigt/udløbet link må ikke efterlade en fremmed session i
      // browseren — ellers kan man navigere videre til /portal/dashboard og
      // se den forrige kundes data.
      clearPortalSessions();
      setError(err.message || t("invalidLink"));
    },
  });

  // Læs kun den token-scopede nøgle — aldrig den generiske.
  useEffect(() => {
    setExistingSessionToken(
      storageKey ? localStorage.getItem(storageKey) : null,
    );
    setHasReadStorage(true);
  }, [storageKey]);

  const validateExisting = trpc.publicPortal.validateSession.useQuery(
    { sessionToken: existingSessionToken || "" },
    {
      enabled: hasReadStorage && !!existingSessionToken && isValidatingExisting,
      retry: false,
    },
  );

  // Bælte og seler: genbrug kun en session serveren stadig knytter til en
  // konkret portaladgang.
  const existingAccessId =
    validateExisting.data && "access" in validateExisting.data
      ? validateExisting.data.access?.id
      : undefined;

  useEffect(() => {
    if (!token || !hasReadStorage) return;

    // Blankt token (fx /portal/t/%20) er ikke et link til nogen — afvis det
    // her i stedet for at lade det falde igennem til en fremmed session.
    if (!storageKey) {
      if (!hasValidated.current) {
        hasValidated.current = true;
        clearPortalSessions();
        setError(t("invalidLink"));
        setIsValidatingExisting(false);
      }
      return;
    }

    // Check if we have an existing valid session for THIS token
    if (existingSessionToken && existingAccessId) {
      setSessionToken(existingSessionToken);
      // Hold den generiske nøgle i sync, så de øvrige portalsider viser den
      // kunde linket peger på.
      localStorage.setItem(PORTAL_SESSION_KEY, existingSessionToken);
      setIsValidatingExisting(false);
      return;
    }

    // Ingen scopet session (eller den er ugyldig) ⇒ valider altid token'et.
    if (
      !existingSessionToken ||
      validateExisting.isSuccess ||
      validateExisting.isError
    ) {
      setIsValidatingExisting(false);

      // Validate the token from URL
      if (!hasValidated.current && !sessionToken) {
        hasValidated.current = true;
        // Ryd den generiske nøgle FØR valideringen. Fejler token'et (eller er
        // det udløbet), står der ikke en fremmed kundes session tilbage til
        // resten af portalen.
        localStorage.removeItem(PORTAL_SESSION_KEY);
        validateMutation.mutate({ token });
      }
    }
  }, [
    token,
    storageKey,
    hasReadStorage,
    existingSessionToken,
    existingAccessId,
    validateExisting.isSuccess,
    validateExisting.isError,
    sessionToken,
    validateMutation.mutate,
    t,
  ]);

  // Show loading while checking existing session or validating token
  if (isValidatingExisting || validateMutation.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">
            {t("validating")}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <svg
              aria-hidden="true"
              className="h-6 w-6 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {t("deniedTitle")}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{error}</p>
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-500">
            {t("deniedText")}
          </p>
        </div>
      </div>
    );
  }

  if (!sessionToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  return <PortalDashboard sessionToken={sessionToken} />;
}

const DOKPLOY_TIMEOUT_MS = 15_000;
const DOKPLOY_API_URL = process.env.DOKPLOY_API_URL;
const DOKPLOY_API_TOKEN = process.env.DOKPLOY_API_TOKEN;
const DOKPLOY_APP_ID = process.env.DOKPLOY_APP_ID;

function isDokployConfigured(): boolean {
  return !!(DOKPLOY_API_URL && DOKPLOY_API_TOKEN && DOKPLOY_APP_ID);
}

/**
 * Register a custom domain with Dokploy for automatic SSL via Let's Encrypt.
 * Gracefully logs a warning if Dokploy env vars are not configured.
 */
export async function registerDomainWithDokploy(
  domain: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isDokployConfigured()) {
    console.warn(
      "[Dokploy] Env vars not configured (DOKPLOY_API_URL, DOKPLOY_API_TOKEN, DOKPLOY_APP_ID). Skipping domain registration.",
    );
    return { success: false, error: "Dokploy not configured" };
  }

  try {
    const response = await fetch(`${DOKPLOY_API_URL}/api/domain.create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DOKPLOY_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(DOKPLOY_TIMEOUT_MS),
      body: JSON.stringify({
        applicationId: DOKPLOY_APP_ID,
        host: domain,
        https: true,
        certificateType: "letsencrypt",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Dokploy] Failed to register domain:", errorText);
      return { success: false, error: errorText };
    }

    console.log(`[Dokploy] Domain registered: ${domain}`);
    return { success: true };
  } catch (error) {
    console.error("[Dokploy] Error registering domain:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove a custom domain from Dokploy.
 * Gracefully logs a warning if Dokploy env vars are not configured.
 */
export async function removeDomainFromDokploy(
  domain: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isDokployConfigured()) {
    console.warn("[Dokploy] Env vars not configured. Skipping domain removal.");
    return { success: false, error: "Dokploy not configured" };
  }

  try {
    // First, find the domain ID by listing domains for the app
    const listResponse = await fetch(
      `${DOKPLOY_API_URL}/api/domain.byApplicationId`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DOKPLOY_API_TOKEN}`,
        },
        signal: AbortSignal.timeout(DOKPLOY_TIMEOUT_MS),
        body: JSON.stringify({
          applicationId: DOKPLOY_APP_ID,
        }),
      },
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error("[Dokploy] Failed to list domains:", errorText);
      return { success: false, error: errorText };
    }

    const domains = (await listResponse.json()) as Array<{
      domainId: string;
      host: string;
    }>;
    const domainEntry = domains.find(
      (d) => d.host.toLowerCase() === domain.toLowerCase(),
    );

    if (!domainEntry) {
      console.warn(`[Dokploy] Domain not found in Dokploy: ${domain}`);
      return { success: true }; // Not an error — domain was never registered
    }

    const deleteResponse = await fetch(`${DOKPLOY_API_URL}/api/domain.delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DOKPLOY_API_TOKEN}`,
      },
      signal: AbortSignal.timeout(DOKPLOY_TIMEOUT_MS),
      body: JSON.stringify({
        domainId: domainEntry.domainId,
      }),
    });

    if (!deleteResponse.ok) {
      const errorText = await deleteResponse.text();
      console.error("[Dokploy] Failed to delete domain:", errorText);
      return { success: false, error: errorText };
    }

    console.log(`[Dokploy] Domain removed: ${domain}`);
    return { success: true };
  } catch (error) {
    console.error("[Dokploy] Error removing domain:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

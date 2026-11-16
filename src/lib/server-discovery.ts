import { getBrand } from "@/lib/brand";
import { getAppUrl } from "@/lib/config";
import { SERVER_VERSION } from "@/lib/version/server-version";

/** Version 1 is the device-login / tRPC / SSE contract. */
export const SERVER_API_VERSION = 1;

export function serverDiscovery() {
  const origin = new URL(getAppUrl()).origin;
  return {
    protocol: "timetrack",
    product: getBrand().name,
    serverVersion: SERVER_VERSION,
    apiVersion: { min: SERVER_API_VERSION, max: SERVER_API_VERSION },
    authMethods: ["device-login", "oauth"],
    urls: {
      deviceLogin: `${origin}/auth/device`,
      trpc: `${origin}/api/trpc`,
      stream: `${origin}/api/ext/stream`,
    },
    capabilities: {
      realtime:
        process.env.REALTIME_ENABLED === "true" && !!process.env.VALKEY_URL,
      electric: !!process.env.ELECTRIC_URL && !!process.env.ELECTRIC_SECRET,
      // Native APNs/FCM delivery is not available to self-hosted servers.
      push: false,
    },
  };
}

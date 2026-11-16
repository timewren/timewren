import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { runtimeBuildMismatches } = await import("@/lib/runtime-env");
    const mismatched = runtimeBuildMismatches();
    if (mismatched.length > 0) {
      // Statiske sider (marketing) har build-værdien i HTML'en, klienten
      // bruger runtime-værdien: byg om med de endelige værdier (#1017).
      console.warn(
        `[runtime-config] ${mismatched.join(", ")} afviger fra build-værdien; statiske sider viser stadig build-værdien.`,
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;

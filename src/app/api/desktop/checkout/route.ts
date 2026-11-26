import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { SITE_LOCALES, sitePath } from "@/lib/brands/timewren-site";
import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { desktopBrandForHost } from "@/lib/desktop-license-brand";
import {
  assertPublicRateLimit,
  startDesktopLifetimeCheckout,
} from "@/lib/trpc/routers/desktop";

/**
 * POST /api/desktop/checkout (form post, TimeWren only)
 *
 * The buy button on timewren.com/desktop is a plain HTML form (the marketing
 * site ships no client JavaScript): email + locale in, 303 to Stripe Checkout
 * out. TimeTrack buys through trpc.desktop.createLifetimeCheckout instead, so
 * on any other host this route does not exist.
 *
 * Failures redirect back to the desktop page with a fragment the page shows
 * with CSS :target: #error (generic) or #included (the email already has a
 * Cloud subscription, which includes desktop).
 */
const form = z.object({
  email: z.string().trim().email().max(254),
  locale: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  const host = request.headers.get("host");
  if (desktopBrandForHost(host) !== "timewren") {
    return new NextResponse(null, { status: 404 });
  }

  const parsed = form.safeParse(
    Object.fromEntries(await request.formData().catch(() => new FormData())),
  );
  const locale =
    SITE_LOCALES.find((l) => l === parsed.data?.locale) ?? SITE_LOCALES[0];
  const back = (fragment: string) =>
    NextResponse.redirect(
      `${siteBaseUrl()}${sitePath("/desktop", locale)}#${fragment}`,
      303,
    );
  if (!parsed.success) return back("error");

  try {
    await assertPublicRateLimit(request.headers, "desktopCheckout");
    const { url } = await startDesktopLifetimeCheckout({
      email: parsed.data.email,
      host,
      locale,
    });
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof TRPCError && error.code === "BAD_REQUEST") {
      return back("included");
    }
    if (!(error instanceof TRPCError)) {
      console.error("[Desktop checkout] Error:", error);
    }
    return back("error");
  }
}

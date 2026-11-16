"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlausible } from "next-plausible";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { appLinkHref } from "@/lib/config";

export interface NavigationLabels {
  mainMenu: string;
  homeLabel: string;
  login: string;
  tryFree: string;
  openMenu: string;
  closeMenu: string;
  /** Tekst pr. href for PRIMARY. */
  primary: Record<string, string>;
  /** Tekst pr. href for SECONDARY. */
  secondary: Record<string, string>;
}

/** Segmenterne står direkte i menuen (mockup docs/brand/forside.html). */
const PRIMARY = [
  "/selvstaendig",
  "/teams-og-bureauer",
  "/virksomheder",
  "/privat",
  "/pricing",
].map((href) => ({ href }));

/** Kun i mobilmenuen; på desktop ligger de i footeren. */
const SECONDARY = ["/integrations", "/vaerktoejer", "/blog", "/tillid"].map(
  (href) => ({ href }),
);

export function NavigationClient({ labels }: { labels: NavigationLabels }) {
  const plausible = usePlausible();
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const trackSignup = (location: string) =>
    plausible("cta_signup_click", {
      props: { location, href: "/register" },
    });

  const linkClass = (href: string) =>
    `text-[15px] transition-colors hover:text-tt-blaek ${
      pathname === href ? "font-medium text-tt-blaek" : "text-tt-graa"
    }`;

  return (
    <nav
      aria-label={labels.mainMenu}
      className={`tt-lys fixed inset-x-0 top-0 z-50 border-b bg-tt-papir transition-colors ${
        isScrolled || mobileOpen ? "border-tt-streg" : "border-transparent"
      }`}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/" aria-label={labels.homeLabel} className="rounded-lg">
            <Logo size="md" />
          </Link>

          <div className="hidden flex-1 items-center justify-end gap-7 lg:flex">
            {PRIMARY.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={linkClass(l.href)}
                aria-current={pathname === l.href ? "page" : undefined}
              >
                {labels.primary[l.href]}
              </Link>
            ))}
            <Link
              href={appLinkHref("/login")}
              className="text-[15px] font-medium text-tt-blaek hover:text-tt-gran"
            >
              {labels.login}
            </Link>
            <Link
              href={appLinkHref("/register")}
              onClick={() => trackSignup("nav_desktop")}
              className="inline-flex min-h-10 items-center rounded-lg bg-tt-gran px-4 text-[15px] font-semibold text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {labels.tryFree}
            </Link>
          </div>

          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile"
            aria-label={mobileOpen ? labels.closeMenu : labels.openMenu}
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-tt-blaek hover:bg-tt-flade lg:hidden"
          >
            {mobileOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Menu className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div
          id="nav-mobile"
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-tt-streg bg-tt-papir px-4 pb-6 lg:hidden"
        >
          <ul className="pt-3">
            {PRIMARY.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center text-lg font-semibold text-tt-blaek"
                >
                  {labels.primary[l.href]}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="mt-3 border-t border-tt-streg pt-3">
            {SECONDARY.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center text-base text-tt-graa"
                >
                  {labels.secondary[l.href]}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid gap-3">
            <Link
              href={appLinkHref("/register")}
              onClick={() => trackSignup("nav_mobile")}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-tt-gran px-4 text-base font-semibold text-tt-paa-gran"
            >
              {labels.tryFree}
            </Link>
            <Link
              href={appLinkHref("/login")}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-tt-kant px-4 text-base font-semibold text-tt-blaek"
            >
              {labels.login}
            </Link>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

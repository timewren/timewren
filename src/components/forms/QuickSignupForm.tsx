"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePlausible } from "next-plausible";

interface QuickSignupFormProps {
  variant?: "hero" | "footer";
}

export function QuickSignupForm({ variant = "hero" }: QuickSignupFormProps) {
  const t = useTranslations("forms");
  const plausible = usePlausible();
  const isHero = variant === "hero";

  return (
    <div className="w-full space-y-4">
      <Link
        href="/register"
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition-all hover:shadow-lg ${
          isHero
            ? "bg-brand-600 px-8 py-4 text-white hover:bg-brand-700"
            : "bg-white px-8 py-4 text-brand-700 hover:bg-brand-50"
        }`}
        onClick={() =>
          plausible("cta_signup_click", {
            props: { location: `quicksignup_${variant}`, href: "/register" },
          })
        }
      >
        {t("quickSignup.cta")}
        <ArrowRight className="h-5 w-5" />
      </Link>
    </div>
  );
}

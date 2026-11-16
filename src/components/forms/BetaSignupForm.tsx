"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { trpc } from "@/providers/trpc-provider";

type BetaSchemaMessages = { emailInvalid: string; messageMax: string };

const createBetaSignupSchema = (m: BetaSchemaMessages) =>
  z.object({
    email: z.string().email(m.emailInvalid),
    name: z.string().optional(),
    company: z.string().optional(),
    currentTool: z.enum(["effihub", "excel", "andet", "ingen"]).optional(),
    message: z.string().max(500, m.messageMax).optional(),
    // Honeypot field - should always be empty (bots fill it)
    website: z.string().max(0).optional(),
  });

type BetaSignupForm = z.infer<ReturnType<typeof createBetaSignupSchema>>;

interface BetaSignupFormProps {
  variant?: "hero" | "footer";
}

export function BetaSignupForm({ variant = "hero" }: BetaSignupFormProps) {
  const t = useTranslations("forms");
  const betaSignupSchema = useMemo(
    () =>
      createBetaSignupSchema({
        emailInvalid: t("beta.emailInvalid"),
        messageMax: t("beta.messageMax"),
      }),
    [t],
  );
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<BetaSignupForm>({
    resolver: zodResolver(betaSignupSchema),
  });

  const registerMutation = trpc.betaSignup.register.useMutation({
    onSuccess: () => {
      setIsSuccess(true);
      reset();
      setTimeout(() => setIsSuccess(false), 5000);
    },
  });

  const onSubmit = async (data: BetaSignupForm) => {
    try {
      await registerMutation.mutateAsync(data);
    } catch (_error) {
      // Error is handled by mutation
    }
  };

  if (isSuccess) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/30 p-4 text-green-800 dark:text-green-300">
        <Check className="h-5 w-5" />
        <p className="text-sm font-medium">{t("beta.success")}</p>
      </div>
    );
  }

  const isHero = variant === "hero";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="w-full space-y-4">
      {/* Honeypot field - hidden from real users, bots will fill it */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          top: "-9999px",
          opacity: 0,
          height: 0,
          overflow: "hidden",
        }}
      >
        <label htmlFor="beta-website">Website</label>
        <input
          type="text"
          id="beta-website"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      <div className={isHero ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>
        <div className={isHero ? "sm:col-span-2" : ""}>
          <input
            {...register("email")}
            type="email"
            placeholder={t("beta.emailPlaceholder")}
            className="w-full rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          {errors.email && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              {errors.email.message}
            </p>
          )}
        </div>

        {isHero && (
          <>
            <div>
              <input
                {...register("name")}
                type="text"
                placeholder={t("beta.namePlaceholder")}
                className="w-full rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <input
                {...register("company")}
                type="text"
                placeholder={t("beta.companyPlaceholder")}
                className="w-full rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div className="sm:col-span-2">
              <select
                {...register("currentTool")}
                className="w-full rounded-lg border-2 border-gray-400 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="">{t("beta.currentTool")}</option>
                <option value="effihub">Effihub</option>
                <option value="excel">{t("beta.toolExcel")}</option>
                <option value="andet">{t("beta.toolOther")}</option>
                <option value="ingen">{t("beta.toolNone")}</option>
              </select>
            </div>
          </>
        )}
      </div>

      {registerMutation.error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 p-3 text-sm text-red-800 dark:text-red-300">
          {registerMutation.error.message}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("beta.signingUp")}
          </span>
        ) : (
          t("beta.cta")
        )}
      </button>

      <p className="text-center text-xs text-gray-500 dark:text-gray-400">
        {t("beta.note")}
      </p>
    </form>
  );
}

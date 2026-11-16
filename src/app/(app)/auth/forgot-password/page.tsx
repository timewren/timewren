"use client";

import { ArrowLeft, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { forgetPassword } from "@/lib/auth-client";

interface ForgotPasswordForm {
  email: string;
}

export default function ForgotPasswordPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("auth.forgot");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordForm>();

  const onSubmit = async (data: ForgotPasswordForm) => {
    setIsLoading(true);
    try {
      const response = await forgetPassword({
        email: data.email,
        redirectTo: "/auth/reset-password",
      });

      if (response.error) {
        toast.error(t("sendFailed"));
      } else {
        setEmailSent(true);
        toast.success(t("sent"));
      }
    } catch (_error) {
      toast.error(t("networkError"));
    } finally {
      setIsLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4 py-12 sm:px-6 lg:px-8">
        <Logo size="lg" />
        <div className="w-full max-w-md space-y-8">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Mail className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>

            <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
              {t("checkEmailTitle")}
            </h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">
              {t("checkEmailText")}
            </p>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("spamHint")}
            </p>

            <div className="mt-6">
              <Link
                href="/login"
                className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("backToLogin")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4 py-12 sm:px-6 lg:px-8">
      <Logo size="lg" />
      <div className="w-full max-w-md space-y-8">
        <div>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backToLogin")}
          </Link>

          <h2 className="mt-6 text-3xl font-bold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("intro", { brand: brand.name })}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("emailLabel")}
              </label>
              <input
                id="email"
                type="email"
                {...register("email", {
                  required: t("emailRequired"),
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: t("emailInvalid"),
                  },
                })}
                className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder={t("emailPlaceholder")}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {errors.email.message}
                </p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isLoading ? t("sending") : t("submit")}
          </button>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400">
            {t("rememberPassword")}{" "}
            <Link
              href="/login"
              className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {t("loginHere")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

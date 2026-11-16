"use client";

import { CheckCircle, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { BrandLogo as Logo } from "@/components/BrandContext";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { resetPassword } from "@/lib/auth-client";

interface ResetPasswordForm {
  password: string;
  confirmPassword: string;
}

function ResetPasswordContent() {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordForm>();

  const password = watch("password");

  const onSubmit = async (data: ResetPasswordForm) => {
    if (!token) {
      toast.error(t("invalidLinkToast"));
      return;
    }

    setIsLoading(true);
    try {
      const response = await resetPassword({
        newPassword: data.password,
        token,
      });

      if (response.error) {
        toast.error(t("expiredToast"));
      } else {
        setResetSuccess(true);
        toast.success(t("successToast"));
        setTimeout(() => {
          router.push("/login");
        }, 3000);
      }
    } catch (_error) {
      toast.error(t("networkError"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4 py-12">
        <Logo size="lg" />
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 p-8 shadow-sm">
            <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
              {t("invalidLinkTitle")}
            </h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">
              {t("invalidLinkText")}
            </p>
            <Link
              href="/auth/forgot-password"
              className="inline-flex rounded-lg bg-tt-gran px-4 py-2 text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              {t("requestNewLink")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (resetSuccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-tt-flade px-4 py-12">
        <Logo size="lg" />
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 shadow-sm">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>

            <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
              {t("successTitle")}
            </h2>
            <p className="mb-6 text-gray-600 dark:text-gray-400">
              {t("successText")}
            </p>

            <Link
              href="/login"
              className="inline-flex rounded-lg bg-tt-gran px-4 py-2 text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              {t("loginNow")}
            </Link>
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
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys">
            <Lock className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          </div>

          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("intro")}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
            <div className="space-y-4">
              {/* Password field */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("newPassword")}
                </label>
                <div className="relative mt-1">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    {...register("password", {
                      required: t("passwordRequired"),
                      minLength: {
                        value: 8,
                        message: t("passwordMin"),
                      },
                    })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2 pr-10 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder={t("passwordPlaceholder")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? t("hidePassword") : t("showPassword")
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* Confirm password field */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("confirmPassword")}
                </label>
                <div className="relative mt-1">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    {...register("confirmPassword", {
                      required: t("confirmRequired"),
                      validate: (value) => value === password || t("mismatch"),
                    })}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2 pr-10 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder={t("confirmPlaceholder")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={
                      showConfirmPassword
                        ? t("hidePassword")
                        : t("showPassword")
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isLoading ? t("resetting") : t("submit")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<LoadingScreen fullScreen />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

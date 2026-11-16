"use client";

import {
  ArrowRight,
  Bot,
  Calendar,
  Check,
  Copy,
  Loader2,
  Mail,
  Shield,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

interface AISetupStepProps {
  onNext: (data: {
    aiAutonomyLevel: string;
    emailEnabled: boolean;
    calendarConnected: boolean;
  }) => void;
  onBack?: () => void;
}

const AI_AUTONOMY_OPTIONS = [
  { value: "suggest", icon: Sparkles, recommended: true },
  { value: "auto_lowrisk", icon: Bot },
  { value: "manual", icon: Shield },
];

export function AISetupStep({ onNext, onBack }: AISetupStepProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("onboarding.ai");
  const [autonomyLevel, setAutonomyLevel] = useState("suggest");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const utils = trpc.useUtils();

  // Queries
  const { data: emailSettings, isLoading: emailLoading } =
    trpc.user.getEmailToTaskSettings.useQuery();

  // Mutations
  const enableEmailMutation = trpc.user.enableEmailToTask.useMutation({
    onSuccess: () => {
      setEmailEnabled(true);
      toast.success(t("emailEnabledToast"));
      utils.user.getEmailToTaskSettings.invalidate();
    },
    onError: (error) => {
      toast.error(t("emailEnableFailed"), {
        description: error.message,
      });
    },
  });

  const updateAIMutation = trpc.user.updateAISettings.useMutation();

  const handleCopyEmail = () => {
    if (emailSettings?.inboundEmail) {
      navigator.clipboard.writeText(emailSettings.inboundEmail);
      setCopiedEmail(true);
      toast.success(t("emailCopied"));
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const handleEnableEmail = () => {
    enableEmailMutation.mutate();
  };

  const handleNext = async () => {
    setIsSubmitting(true);
    try {
      // Save AI autonomy level
      await updateAIMutation.mutateAsync({
        aiAutonomyLevel: autonomyLevel as
          | "manual"
          | "suggest"
          | "auto_lowrisk"
          | "auto_all",
      });

      onNext({
        aiAutonomyLevel: autonomyLevel,
        emailEnabled: emailSettings?.enabled || emailEnabled,
        calendarConnected: false, // Calendar setup is optional, can be done later
      });
    } catch (_error) {
      toast.error(t("saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-600">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">{t("title")}</h2>
        <p className="mt-2 text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Email-to-Task Section */}
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-brand-100">
            <Mail className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{t("emailToTask")}</h3>
            <p className="text-sm text-gray-500">{t("emailToTaskDesc")}</p>
          </div>
        </div>

        {emailLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : emailSettings?.enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3">
              <Check className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-green-800">
                {t("emailIsEnabled")}
              </span>
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">
                {t("personalEmail")}
              </span>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <code className="flex-1 text-sm font-mono text-gray-900">
                    {emailSettings.inboundEmail}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  title={t("copyEmail")}
                >
                  {copiedEmail ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-500" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">{t("emailHint")}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-gray-600 mb-4">{t("activateHint")}</p>
            <button
              type="button"
              onClick={handleEnableEmail}
              disabled={enableEmailMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {enableEmailMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {t("activate")}
            </button>
          </div>
        )}
      </div>

      {/* AI Autonomy Level */}
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-brand-100">
            <Bot className="h-5 w-5 text-brand-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{t("autonomy")}</h3>
            <p className="text-sm text-gray-500">{t("autonomyDesc")}</p>
          </div>
        </div>

        <div className="space-y-3">
          {AI_AUTONOMY_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = autonomyLevel === option.value;

            return (
              <button
                type="button"
                key={option.value}
                onClick={() => setAutonomyLevel(option.value)}
                className={`
                  w-full flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all
                  ${
                    isSelected
                      ? "border-brand-500 bg-brand-50"
                      : "border-gray-200 hover:border-gray-300"
                  }
                `}
              >
                <div
                  className={`p-2 rounded-lg ${isSelected ? "bg-brand-100" : "bg-gray-100"}`}
                >
                  <Icon
                    className={`h-4 w-4 ${isSelected ? "text-brand-600" : "text-gray-500"}`}
                  />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-medium ${isSelected ? "text-brand-700" : "text-gray-900"}`}
                    >
                      {t(`option.${option.value}.label`)}
                    </span>
                    {option.recommended && (
                      <span className="px-2 py-0.5 text-xs font-medium text-brand-600 bg-brand-100 rounded-full">
                        {t("recommended")}
                      </span>
                    )}
                    {isSelected && (
                      <Check className="h-4 w-4 text-brand-600 ml-auto" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {t(`option.${option.value}.description`)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Google Calendar Info */}
      <div className="rounded-lg border border-gray-200 p-6 bg-gray-50">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-amber-100">
            <Calendar className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{t("calendar")}</h3>
            <p className="text-sm text-gray-500">{t("calendarDesc")}</p>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          {t.rich("calendarLater", {
            brand: brand.name,
            b: (chunks) => <span className="font-medium">{chunks}</span>,
          })}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
          >
            {t("back")}
          </button>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={handleNext}
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 px-8 py-3 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {t("continue")}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

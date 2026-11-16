import { Bug } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isSentryActive, sendFeedback } from "@/lib/sentry";
import { toast } from "@/stores/toastStore";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

/**
 * `value` er den streng der sendes videre i rapporten, så den er dansk uanset
 * hvilket sprog appen står i — kun `labelKey` er oversat. Samme skel som de
 * niveauer Rust sender, og det er derfor kategorien kan nulstilles med
 * `CATEGORIES[0].value` i stedet for en dansk streng der står to steder.
 */
const CATEGORIES = [
  { value: "Fejl", labelKey: "feedback.categoryBug" },
  { value: "Mangel/ønske", labelKey: "feedback.categoryRequest" },
  { value: "Andet", labelKey: "feedback.categoryOther" },
] as const;

const fieldClass =
  "rounded-md border border-(--color-border) bg-(--color-surface) px-2.5 text-sm text-(--color-text) placeholder:text-(--color-text-muted)";

/**
 * "Indberet fejl eller mangel" — self-contained trigger + dialog. Sends the
 * report to Sentry (a Sentry alert rule can forward it to email automatically).
 */
export function FeedbackButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORIES[0].value);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit() {
    if (!message.trim()) return;
    setSubmitting(true);
    const sent = sendFeedback({ category, message, email });
    setSubmitting(false);
    if (sent) {
      toast.success(t("feedback.sent"));
      setCategory(CATEGORIES[0].value);
      setMessage("");
      setEmail("");
      setOpen(false);
    } else {
      toast.error(t("feedback.disabledToast"));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-(--color-text-muted) transition-colors hover:bg-(--color-border)/50 hover:text-(--color-text)"
      >
        <Bug size={16} className="shrink-0" />
        {t("feedback.trigger")}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("feedback.trigger")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!message.trim() || submitting}
            >
              {submitting ? t("feedback.sending") : t("feedback.send")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-(--color-text-muted)">
            {t("feedback.intro")}
          </p>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="feedback-category"
              className="text-xs font-medium text-(--color-text)"
            >
              {t("feedback.category")}
            </label>
            <select
              id="feedback-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`h-9 ${fieldClass}`}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="feedback-message"
              className="text-xs font-medium text-(--color-text)"
            >
              {t("common.description")}
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder={t("feedback.descriptionPlaceholder")}
              className={`resize-none py-2 ${fieldClass}`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="feedback-email"
              className="text-xs font-medium text-(--color-text)"
            >
              {t("feedback.emailLabel")}
            </label>
            <input
              id="feedback-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("feedback.emailPlaceholder")}
              className={`h-9 ${fieldClass}`}
            />
          </div>

          {!isSentryActive() && (
            <p className="text-xs text-amber-500">
              {t("feedback.disabledNote")}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}

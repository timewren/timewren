"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePlausible } from "next-plausible";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { trpc } from "@/providers/trpc-provider";

type ContactSchemaMessages = {
  nameMin: string;
  emailInvalid: string;
  subjectMin: string;
  messageMin: string;
};

const createContactSchema = (m: ContactSchemaMessages) =>
  z.object({
    name: z.string().min(2, m.nameMin),
    email: z.string().email(m.emailInvalid),
    subject: z.string().min(5, m.subjectMin),
    message: z.string().min(10, m.messageMin),
  });

type ContactForm = z.infer<ReturnType<typeof createContactSchema>>;

export function ContactForm() {
  const t = useTranslations("forms");
  const contactSchema = useMemo(
    () =>
      createContactSchema({
        nameMin: t("contact.nameMin"),
        emailInvalid: t("contact.emailInvalid"),
        subjectMin: t("contact.subjectMin"),
        messageMin: t("contact.messageMin"),
      }),
    [t],
  );
  const plausible = usePlausible();
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
  });

  const sendMutation = trpc.contact.send.useMutation({
    onSuccess: () => {
      plausible("contact_submit", {
        props: { page: "/contact" },
      });
      setIsSuccess(true);
      reset();
      setTimeout(() => setIsSuccess(false), 5000);
    },
  });

  const onSubmit = async (data: ContactForm) => {
    try {
      await sendMutation.mutateAsync(data);
    } catch (_error) {
      // Error is handled by mutation
    }
  };

  if (isSuccess) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 p-4 text-green-800">
        <Check className="h-5 w-5" />
        <p className="text-sm font-medium">{t("contact.success")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div>
        <label
          htmlFor="name"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {t("contact.name")}
        </label>
        <input
          {...register("name")}
          type="text"
          id="name"
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          placeholder={t("contact.namePlaceholder")}
        />
        {errors.name && (
          <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="email"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {t("contact.email")}
        </label>
        <input
          {...register("email")}
          type="email"
          id="email"
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          placeholder={t("contact.emailPlaceholder")}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="subject"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {t("contact.subject")}
        </label>
        <input
          {...register("subject")}
          type="text"
          id="subject"
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          placeholder={t("contact.subjectPlaceholder")}
        />
        {errors.subject && (
          <p className="mt-1 text-sm text-red-600">{errors.subject.message}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="message"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {t("contact.message")}
        </label>
        <textarea
          {...register("message")}
          id="message"
          rows={6}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          placeholder={t("contact.messagePlaceholder")}
        />
        {errors.message && (
          <p className="mt-1 text-sm text-red-600">{errors.message.message}</p>
        )}
      </div>

      {sendMutation.error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {sendMutation.error.message}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("contact.sending")}
          </span>
        ) : (
          t("contact.send")
        )}
      </button>
    </form>
  );
}

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { withoutServerNamespaces } from "@/i18n/client-messages";
import { AppProviders } from "@/providers/app-providers";
import AdminShell from "./AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={withoutServerNamespaces(messages)}>
      <AppProviders>
        <AdminShell>{children}</AdminShell>
      </AppProviders>
    </NextIntlClientProvider>
  );
}

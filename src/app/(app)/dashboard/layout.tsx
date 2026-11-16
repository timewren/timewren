import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { withoutServerNamespaces } from "@/i18n/client-messages";
import { AppProviders } from "@/providers/app-providers";
import DashboardShell from "./DashboardShell";

// Providers for de indloggede flader bor her i stedet for i root-layoutet, så
// marketingsiderne ikke skal hente tRPC/React Query og next-intls klientdel.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={withoutServerNamespaces(messages)}>
      <AppProviders>
        <DashboardShell>{children}</DashboardShell>
      </AppProviders>
    </NextIntlClientProvider>
  );
}

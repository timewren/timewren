import { NextIntlClientProvider } from "next-intl";
import { getClientMessages } from "@/i18n/server";

export default async function OfflineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await getClientMessages("offline")}>
      {children}
    </NextIntlClientProvider>
  );
}

import { NextIntlClientProvider } from "next-intl";
import { getClientMessages } from "@/i18n/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await getClientMessages("auth")}>
      {children}
    </NextIntlClientProvider>
  );
}

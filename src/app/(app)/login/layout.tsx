import { NextIntlClientProvider } from "next-intl";
import { getClientMessages } from "@/i18n/server";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={await getClientMessages("auth", "authLogin")}
    >
      {children}
    </NextIntlClientProvider>
  );
}

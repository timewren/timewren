import { NextIntlClientProvider } from "next-intl";
import { getClientMessages } from "@/i18n/server";

export default async function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={await getClientMessages("auth", "authRegister")}
    >
      {children}
    </NextIntlClientProvider>
  );
}

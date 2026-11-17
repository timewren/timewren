import { NextIntlClientProvider } from "next-intl";
import { getClientMessages } from "@/i18n/server";
import { isDemoMode } from "@/lib/demo/demo-mode";

export default async function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={
        await getClientMessages(
          "auth",
          "authLogin",
          // Kun demoen (DEMO_MODE=1) bruger demo-teksterne.
          ...(isDemoMode() ? ["demo"] : []),
        )
      }
    >
      {children}
    </NextIntlClientProvider>
  );
}

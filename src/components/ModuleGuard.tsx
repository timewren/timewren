"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { useModules } from "@/hooks/useModules";
import type { ModuleKey } from "@/lib/modules/constants";

interface ModuleGuardProps {
  module: ModuleKey;
  children: React.ReactNode;
}

export function ModuleGuard({ module, children }: ModuleGuardProps) {
  const t = useTranslations("shell.guard");
  const { isEnabled, isLoading, isPlaceholder, isError } = useModules();
  const router = useRouter();

  useEffect(() => {
    // Vent på rigtige moduldata. Placeholder'en indeholder kun CORE_BUNDLE, så
    // ikke-core moduler (fx tasks) ville fejlagtigt se "ikke aktiveret" ud og
    // udløse en spuriøs fejl-toast + redirect før data er hentet. Ved fejl
    // (netværksblip, retries opbrugt) gør vi heller intet — backend-guarden
    // er autoritativ; ellers ville et blip smide brugeren ud med misvisende
    // "ikke aktiveret".
    if (isLoading || isPlaceholder || isError) return;
    if (!isEnabled(module)) {
      toast.error(t("moduleDisabled", { module: t(`module.${module}`) }));
      router.replace("/dashboard");
    }
  }, [isEnabled, isLoading, isPlaceholder, isError, module, router, t]);

  if (isLoading || isPlaceholder) {
    return null;
  }
  // Kunne ikke afgøre modul-status (fejl): rendér indholdet og lad backend-
  // modulguarden håndhæve adgangen, frem for en blank side eller falsk redirect.
  if (!isError && !isEnabled(module)) {
    return null;
  }
  return <>{children}</>;
}

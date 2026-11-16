import { toast } from "sonner";
import { currentBrandId } from "@/i18n/brandize";
import { sharedT } from "@/i18n/shared-text";
import { getBrand } from "@/lib/brand";
import { markStaleBuild } from "./stale-build";

const UPDATE_TOAST_ID = "ny-version";
const TOO_OLD_TOAST_ID = "klient-for-gammel";

/** Står afvisnings-prompten, må en udskydelig prompt ikke erstatte den. */
let tooOldShown = false;

/**
 * "Ny version — genindlæs". Bliver stående til brugeren vælger.
 *
 * - `new_version`: serveren kører en nyere build end fanen (/api/version)
 *   eller en ny service worker er klar. Kan udskydes.
 * - `too_old`: serveren har afvist en skrivning med CLIENT_TOO_OLD. Fanen
 *   kan ikke gemme før den er genindlæst, så der er ingen "Senere".
 */
export function showUpdatePrompt(
  reason: "new_version" | "too_old" = "new_version",
) {
  // Næste navigation bliver en fuld sideindlæsning (stale-build.ts).
  markStaleBuild();
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brandName = getBrand(currentBrandId()).name;
  const reload = {
    label: sharedT("sharedFormat", "update.reload"),
    onClick: () => window.location.reload(),
  };
  if (reason === "too_old") {
    tooOldShown = true;
    toast.dismiss(UPDATE_TOAST_ID);
    toast.error(sharedT("sharedFormat", "update.title"), {
      id: TOO_OLD_TOAST_ID,
      description: sharedT("sharedFormat", "update.tooOld", {
        brand: brandName,
      }),
      duration: Number.POSITIVE_INFINITY,
      action: reload,
    });
    return;
  }
  if (tooOldShown) return;
  toast.warning(sharedT("sharedFormat", "update.title"), {
    id: UPDATE_TOAST_ID,
    description: sharedT("sharedFormat", "update.newVersion", {
      brand: brandName,
    }),
    duration: Number.POSITIVE_INFINITY,
    action: reload,
    cancel: {
      label: sharedT("sharedFormat", "update.later"),
      onClick: () => toast.dismiss(UPDATE_TOAST_ID),
    },
  });
}

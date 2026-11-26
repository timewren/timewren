import { isNewTabDisabled, openNativeNewTab } from "../lib/native-newtab";

// Afgøres før React og resten af ny fane hentes: er ny fane slået fra, og kan
// browseren vise sin egen (Chrome), skiftes fanen uden at TimeTrack blinker.
// Ellers indlæses ny fane, som selv viser søgesiden, når den er slået fra.
async function boot() {
  const disabled = await isNewTabDisabled().catch(() => false);
  if (disabled && (await openNativeNewTab())) return;
  await import("./main");
}

void boot();

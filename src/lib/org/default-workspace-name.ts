import { tr } from "@/i18n/server-text";

/**
 * Navnet på en ny brugers personlige arbejdsområde, på brugerens sprog. Det
 * står nederst i menuen fra første login; før var det altid engelsk
 * ("Freja Testesen's workspace"), også i den danske app.
 *
 * Dansk genitiv: navne på s, x og z får apostrof ("Hans' arbejdsområde").
 */
export async function defaultWorkspaceName(
  owner: string,
  locale?: string | null,
): Promise<string> {
  const name = owner.trim();
  const key = /[sxz]$/i.test(name)
    ? "defaultWorkspace.nameSibilant"
    : "defaultWorkspace.name";
  return tr("organization", key, { name }, locale);
}

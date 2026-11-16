/**
 * Renderer rebrand-varslen (RebrandVarselEmail) til HTML og tekst med
 * pladsholderen __FORNAVN__, så afsendelsen kan ske på prod-serveren uden
 * mailkomponenterne i imaget: scripts/brand/send-rebrand-varsel.mjs
 * indsætter fornavnet pr. modtager.
 *
 *   npx tsx scripts/brand/render-rebrand-varsel.tsx <ud-mappe>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/components";
import {
  REBRAND_VARSEL_FROM,
  REBRAND_VARSEL_SUBJECT,
  RebrandVarselEmail,
  rebrandVarselIkrafttraedelse,
} from "../../src/components/email/RebrandVarselEmail";

async function main() {
  const ud = process.argv[2] ?? "rebrand-varsel";
  mkdirSync(ud, { recursive: true });

  const sentAt = new Date();
  const element = <RebrandVarselEmail userName="__FORNAVN__" sentAt={sentAt} />;
  const html = await render(element);
  const text = await render(element, { plainText: true });

  writeFileSync(join(ud, "mail.html"), html);
  writeFileSync(join(ud, "mail.txt"), text);
  writeFileSync(
    join(ud, "meta.json"),
    JSON.stringify(
      {
        subject: REBRAND_VARSEL_SUBJECT,
        from: REBRAND_VARSEL_FROM,
        gaelderFra: rebrandVarselIkrafttraedelse(sentAt),
        renderetAt: sentAt.toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    `Renderet til ${ud} (gælder fra ${rebrandVarselIkrafttraedelse(sentAt)})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

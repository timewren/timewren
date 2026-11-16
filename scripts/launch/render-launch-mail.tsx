/**
 * Renderer LaunchOpenSourceEmail til HTML og tekst med pladsholderen
 * __FORNAVN__, så fletning og afsendelse kan ske på serveren.
 *
 *   NEXT_PUBLIC_BRAND=timetrack NEXT_PUBLIC_APP_URL=https://app.timetrack.dk \
 *     npx tsx scripts/launch/render-launch-mail.tsx <ud-mappe>
 *
 * Mailen går til TimeTrack-kunder, så signatur, portræt og links skal følge
 * TimeTrack-brandet og prod-URL'en. Scriptet stopper, hvis de mangler.
 */
if (
  process.env.NEXT_PUBLIC_BRAND !== "timetrack" ||
  process.env.NEXT_PUBLIC_APP_URL !== "https://app.timetrack.dk"
) {
  console.error(
    "Sæt NEXT_PUBLIC_BRAND=timetrack og NEXT_PUBLIC_APP_URL=https://app.timetrack.dk",
  );
  process.exit(1);
}

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/components";
import {
  LAUNCH_OPEN_SOURCE_FROM,
  LAUNCH_OPEN_SOURCE_SUBJECT,
  LaunchOpenSourceEmail,
} from "../../src/components/email/LaunchOpenSourceEmail";

async function main() {
  const ud = process.argv[2] ?? "launch-mail";
  mkdirSync(ud, { recursive: true });
  const element = <LaunchOpenSourceEmail userName="__FORNAVN__" />;
  writeFileSync(join(ud, "mail.html"), await render(element));
  writeFileSync(
    join(ud, "mail.txt"),
    await render(element, { plainText: true }),
  );
  writeFileSync(
    join(ud, "meta.json"),
    JSON.stringify(
      { subject: LAUNCH_OPEN_SOURCE_SUBJECT, from: LAUNCH_OPEN_SOURCE_FROM },
      null,
      2,
    ),
  );
  console.log(`Renderet til ${ud}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

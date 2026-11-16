/**
 * Testene regner med Danmarks tidszone.
 *
 * Dato- og klokketest i appen skriver forventninger ned i fast tekst
 * ("08:00 – 16:30", "mandag i denne uge"). Uden en låst TZ giver de
 * forskellige svar alt efter hvem der kører dem: en dansk udviklermaskine
 * sagde 08:00, og CI på UTC sagde 06:00, så gaten var rød uden at nogen kode
 * var ændret. `TZ` låses derfor i `package.json` (`pnpm test`).
 *
 * Kørere der springer scriptet over (rå `npx jest`) får et klart svar her
 * frem for en række tests der fejler med uforståelige tal.
 */
const FORVENTET_TZ = 'Europe/Copenhagen';

module.exports = function krævDanskTidszone() {
  const faktisk = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (faktisk === FORVENTET_TZ)
    return;

  throw new Error(
    `Testene skal køre i ${FORVENTET_TZ}, men kørens tidszone er ${faktisk}. `
    + `Brug \`pnpm test\` — den sætter TZ.`,
  );
};

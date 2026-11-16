/**
 * Ren logik for redigering af fakturalinjer på en kladde.
 *
 * Serverens `invoices.saveLines` er en *erstatning*: den sletter alle linjer,
 * der ikke er med i input, og genberegner fakturabeløbet fra det, den får.
 * To ting skal derfor være sande, før vi trykker gem:
 *
 *  1. Listen vi sender er den *fulde* liste. Derfor får hver linje sit
 *     `sortOrder` fra sin position ved gem, ikke fra et felt der kan blive
 *     forældet, og derfor taber `savedLines` det tomme ubrugte felt.
 *  2. Vi ved hvilke registreringer der frigives, så brugeren kan advares
 *     FØR en tidspost bliver fakturerbar to gange.
 *
 * Beløb rundes pr. linje og summen til 2 decimaler, præcis som web'ens
 * `sumMoney`, så forhåndsvisningen er den samme sum serveren gemmer.
 */

export type DraftLine = {
  /** Serverens id, eller `temp-…` for en linje der endnu ikke er gemt. */
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Hvilken tidspost linjen dækker, hvis nogen. */
  timeEntryId: string | null;
};

export type SavedLine = {
  id?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  timeEntryId: string | null;
  sortOrder: number;
};

export type LineProblem = { id: string };

const TEMP_PREFIX = 'temp-';
/** Ubrugte felter har ingen værdi — sådan her ser de ud. */
const BLANK_QTY = '1';
const BLANK_PRICE = '0';

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Tal-felt læses på dansk. `parseFloat('7,5')` er 7 — en bruger med dansk
 * tastatur ville få et beløb der er 500 kr. for lavt uden at se en fejl. Derfor
 * erstattes komma med punktum, inden vi parser. Ét decimaltegn ad gangen, så
 * et tusindtal-separatorformateret felt heller ikke bliver til 1.
 */
function toNumber(value: string | number | null | undefined): number {
  if (typeof value !== 'string') {
    const n = value ?? 0;
    return Number.isFinite(n) ? n : 0;
  }
  const normalized = value.trim().replace(',', '.');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Antal × pris, rundet til 2 decimaler — samme formel som web'ens editor. */
export function lineAmount(quantity: string, unitPrice: string): string {
  return roundMoney(toNumber(quantity) * toNumber(unitPrice)).toFixed(2);
}

export function isBlank(line: Pick<DraftLine, 'description' | 'quantity' | 'unitPrice'>): boolean {
  return line.description.trim() === '' && line.quantity === BLANK_QTY && line.unitPrice === BLANK_PRICE;
}

export function tempId(value: string): boolean {
  return value.startsWith(TEMP_PREFIX);
}

export function newLine(): DraftLine {
  return { id: `${TEMP_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, description: '', quantity: BLANK_QTY, unitPrice: BLANK_PRICE, timeEntryId: null };
}

/** Samlet nettopbeløb, rundet som serverens `sumMoney` over linjernes beløb. */
export function totalOf(lines: DraftLine[]): number {
  return roundMoney(lines.reduce((sum, l) => sum + toNumber(lineAmount(l.quantity, l.unitPrice)), 0));
}

export function updateLine(lines: DraftLine[], id: string, patch: Partial<DraftLine>): DraftLine[] {
  return lines.map(l => (l.id === id ? { ...l, ...patch } : l));
}

export function removeLine(lines: DraftLine[], id: string): DraftLine[] {
  return lines.filter(l => l.id !== id);
}

export function movedLines(lines: DraftLine[], id: string, direction: -1 | 1): DraftLine[] {
  const from = lines.findIndex(l => l.id === id);
  const to = from + direction;
  // Uden for kanterne: gør intet. En fejl her ville tabe en linje fra listen.
  if (from < 0 || to < 0 || to >= lines.length)
    return lines;
  const next = [...lines];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Linjer der ikke må gemmes: en beskrivelse er påkrævet, men et *helt uberørt*
 * felt er ikke en fejl — det er bare et felt brugeren ikke brugte. En tom
 * beskrivelse på en linje der bærer en registrering eller et beløb derimod
 * ville få serveren til at afvise hele gemningen med en uforståelig fejl.
 */
export function findProblems(lines: DraftLine[]): LineProblem[] {
  return lines.filter(l => l.description.trim() === '' && !isBlank(l)).map(l => ({ id: l.id }));
}

/** Registreringer der frigives af dette gem — altså tidsposter der kan faktureres igen. */
export function removedEntryIds(before: DraftLine[], after: DraftLine[]): string[] {
  const kept = new Set(after.map(l => l.id));
  return before.filter(l => !kept.has(l.id)).map(l => l.timeEntryId).filter((id): id is string => !!id);
}

/**
 * Om listen faktisk er ændret. Sammenligner indhold, ikke array-identitet —
 * to ens lister er to forskellige arrays, og et gem-knap der altid er aktivt
 * ville genindsætte nye linjer ved hvert tryk.
 */
export function sameLines(a: DraftLine[], b: DraftLine[]): boolean {
  if (a.length !== b.length)
    return false;
  return a.every((l, i) => {
    const o = b[i];
    return l.id === o.id && l.description === o.description && l.quantity === o.quantity && l.unitPrice === o.unitPrice && l.timeEntryId === o.timeEntryId;
  });
}

/**
 * Nøgle til det vi *vil* sende. Bruges til at genkende et gem-kald der er
 * identisk med et der allerede lykkedes: serveren indsætter en linje med et
 * ukendt `temp-`-id igen, hvis vi sender den samme krop to gange, så et
 * dobbelttryk (eller et gem der gentages inden refetch'en lander) ville give
 * dobbelte fakturalinjer. En identisk nøgle låser derfor knappen.
 */
export function payloadKey(lines: DraftLine[]): string {
  return JSON.stringify(savedLines(lines));
}

/** Det seneste gem vi har sendt, og hvor stor risiko der er for at det landede. */
export type SentSave = {
  key: string;
  /** Sand når serveren *kan* have gemt, så samme krop ikke må sendes igen. */
  mayHaveLanded: boolean;
};

/**
 * Kan et kald med denne HTTP-status have nået at gemme noget?
 *
 * Kun et 4xx er et *svar fra serveren*: den afviste, og `saveLines` sker i én
 * transaction, så alt er rullet tilbage, og den samme krop kan trykkes igen
 * med det samme. Alt andet — en 5xx, en timeout, en tabt forbindelse — kan
 * have gemt: også fordi et svar kan forsvinde *efter* at transaktionen er
 * commitet, og en proxy kan svare 502 på en request der alligevel lykkedes.
 * Derfor er kun 4xx-og-ned ad det sikre at sende igen, og alt andenvis
 * antages at have landet.
 */
export function mayHaveLanded(status: number | undefined): boolean {
  return status === undefined || status < 400 || status >= 500;
}

/**
 * Skal gem-knappen være låst for denne payload?
 *
 * Låsen findes, fordi serveren *indsætter* en linje med et ukendt `temp-`-id
 * igen, hvis den samme krop sendes to gange. Den må derfor aldrig være
 * strammere end sandheden — ellers dør knappen efter ét afvist gem, og
 * brugeren kan kun låse den op ved at ændre et tegn i en linje igen (hvilket
 * på en linje med `timeEntryId` spørger om frigivelse af registreringer igen).
 *
 * Et gem der *lykkedes* holder låsen, indtil den genindlæste `lines` er landet
 * og nulstiller den hele. Et gem der blev *afvist* af serveren (4xx) har
 * rullet transactionen tilbage og frigiver låsen med det samme. Uden et svar
 * — eller ved en 5xx — står låsen, fordi serveren kan have gemt; det er den
 * tabte fil, som en genindlæsning løser ved at spørge serveren hvad der står.
 */
export function saveIsLocked(key: string, sent: SentSave | null): boolean {
  return sent !== null && sent.key === key && sent.mayHaveLanded;
}

/**
 * Klar til `saveLines`. Ubrugte felter tabes, temp-id sendes som `undefined`
 * (serveren skal indsætte dem), og `sortOrder` følger rækkefølgen. To kald med
 * samme input er derfor ens — se `payloadKey` for hvorfor det betyder noget.
 */
export function savedLines(lines: DraftLine[]): SavedLine[] {
  return lines
    .filter(l => !isBlank(l))
    .map((l, index) => ({
      id: tempId(l.id) ? undefined : l.id,
      description: l.description.trim(),
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: lineAmount(l.quantity, l.unitPrice),
      timeEntryId: l.timeEntryId,
      sortOrder: index,
    }));
}

/**
 * "Skriv hvad du lavede" (#681): deterministisk dansk parser, der laver en
 * fritekst-sætning om til et FORSLAG til en tidspost. Ren funktion uden AI,
 * netværk eller tidszone-afhængighed — "i dag" kommer ind som parameter, så
 * samme sætning altid giver samme forslag (og kan testes).
 *
 * Forslaget gemmes aldrig direkte; det udfylder den eksisterende formular,
 * hvor brugeren bekræfter eller retter.
 */

export interface FreetextClient {
  id: string;
  name: string;
  company?: string | null;
}

export interface FreetextProject {
  id: string;
  name: string;
  clientId: string | null;
}

export interface FreetextContext {
  /** Brugerens lokale dato som YYYY-MM-DD */
  today: string;
  clients: FreetextClient[];
  projects: FreetextProject[];
}

export interface FreetextCandidate {
  id: string;
  name: string;
  score: number;
}

export interface FreetextSuggestion {
  /** Timer (decimal). null = ingen varighed fundet */
  hours: number | null;
  /** Dato som YYYY-MM-DD (default: today) */
  date: string;
  /** true når teksten selv nævnte en dag */
  dateFromText: boolean;
  /** "HH:MM" når teksten havde et tidsrum som "kl. 9-11" */
  startTime: string | null;
  endTime: string | null;
  clientId: string | null;
  projectId: string | null;
  /** Bedste kandidater, når navnet var tvetydigt (eller som forklaring) */
  clientCandidates: FreetextCandidate[];
  projectCandidates: FreetextCandidate[];
  /** null = ikke nævnt (formularens/kundens standard gælder) */
  isBillable: boolean | null;
  description: string;
  /** Felter parseren ikke kunne udlede */
  missing: Array<"hours" | "client">;
}

// ---------------------------------------------------------------------------
// Hjælpere
// ---------------------------------------------------------------------------

const L = "a-zæøåéü"; // bogstaver vi betragter som del af et ord
const WORD_START = `(?<![${L}0-9])`;
const WORD_END = `(?![${L}0-9])`;

const NUMBER_WORDS: Record<string, number> = {
  en: 1,
  et: 1,
  én: 1,
  ét: 1,
  to: 2,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  syv: 7,
  otte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
  femten: 15,
  tyve: 20,
  femogtyve: 25,
  tredive: 30,
  femogtredive: 35,
  fyrre: 40,
  femogfyrre: 45,
  halvtreds: 50,
  halvanden: 1.5,
};

// Længste ord først, så "femogtyve" vinder over "fem"
const NUMBER_WORD_ALT = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = `(\\d+(?:[.,]\\d+)?|${NUMBER_WORD_ALT})`;

/** Småord der kan stå foran en varighed: "på 10 minutter", "i 2 timer" */
const DURATION_PREFIX = `(?:${WORD_START}(?:på|i|ca\\.?|cirka|omkring|brugt|brugte)\\s+)*`;

function toNumber(raw: string): number {
  const word = NUMBER_WORDS[raw];
  if (word !== undefined) return word;
  return Number(raw.replace(",", "."));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Arbejdsstreng hvor genkendte dele "spises" (erstattes af mellemrum), så
 * positionerne passer med originalteksten og resten bliver beskrivelsen.
 */
class Workspace {
  readonly original: string;
  work: string;

  constructor(text: string) {
    this.original = text;
    const lower = text.toLowerCase();
    // toLowerCase kan i sjældne tilfælde ændre længden (fx "İ"); så falder vi
    // tilbage til at arbejde på teksten selv, så positionerne stadig passer.
    this.work = lower.length === text.length ? lower : text;
  }

  consume(start: number, end: number): void {
    this.work =
      this.work.slice(0, start) +
      " ".repeat(end - start) +
      this.work.slice(end);
  }

  /** Første match af regex; spiser det og returnerer match-objektet */
  take(re: RegExp): RegExpExecArray | null {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    const m = g.exec(this.work);
    if (!m) return null;
    this.consume(m.index, m.index + m[0].length);
    return m;
  }

  /** Alle matches af regex; spiser dem og returnerer listen */
  takeAll(re: RegExp): RegExpExecArray[] {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const g = new RegExp(re.source, flags);
    const found: RegExpExecArray[] = [];
    for (let m = g.exec(this.work); m; m = g.exec(this.work)) {
      found.push(m);
      if (m[0].length === 0) g.lastIndex++;
    }
    for (const m of found) this.consume(m.index, m.index + m[0].length);
    return found;
  }

  /** Originalteksten med spiste dele blanket ud */
  remainder(): string {
    let out = "";
    for (let i = 0; i < this.original.length; i++) {
      out += this.work[i] === " " ? " " : this.original[i];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Fakturerbar
// ---------------------------------------------------------------------------

function parseBillable(ws: Workspace): boolean | null {
  // Ikke-fakturerbar skal fanges FØR fakturerbar, så "faktureres ikke" ikke
  // tolkes som fakturerbar. "intern(t)"/"intern tid" er et non-billable-signal
  // (jf. #681); ordgrænsen sikrer, at det ikke rammer fx "internorder".
  const nonBillable = ws.take(
    new RegExp(
      `${WORD_START}(?:` +
        `ikke[\\s-]+fakturer(?:bar(?:e|t)?|es|et)|` +
        `fakturer(?:bar(?:e|t)?|es|et)\\s+ikke|` +
        `ufakturerbar(?:e|t)?|` +
        `intern(?:t)?(?:\\s+tid)?` +
        `)${WORD_END}`,
    ),
  );
  if (nonBillable) return false;
  const billable = ws.take(
    new RegExp(`${WORD_START}(?:fakturerbar(?:e|t)?|faktureres)${WORD_END}`),
  );
  if (billable) return true;
  return null;
}

// ---------------------------------------------------------------------------
// Dato
// ---------------------------------------------------------------------------

const WEEKDAYS: Record<string, number> = {
  søndag: 0,
  mandag: 1,
  tirsdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lørdag: 6,
};

const MONTHS: Array<[string, number]> = [
  ["januar", 1],
  ["februar", 2],
  ["marts", 3],
  ["april", 4],
  ["maj", 5],
  ["juni", 6],
  ["juli", 7],
  ["august", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["december", 12],
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["sept", 9],
  ["okt", 10],
  ["nov", 11],
  ["dec", 12],
];
const MONTH_ALT = MONTHS.map(([name]) => name)
  .sort((a, b) => b.length - a.length)
  .join("|");
const MONTH_LOOKUP = new Map(MONTHS);

/** Dato uden årstal: vælg i år, men et "fremtidigt" tal langt ude er sidste år */
function resolveDayMonth(
  today: string,
  day: number,
  month: number,
  year?: number,
): string | null {
  const todayYear = parseIsoDate(today).getUTCFullYear();
  let y = year ?? todayYear;
  if (y < 100) y += 2000;
  if (!isValidDate(y, month, day)) return null;
  let iso = `${y}-${pad2(month)}-${pad2(day)}`;
  if (year === undefined) {
    const diffDays =
      (parseIsoDate(iso).getTime() - parseIsoDate(today).getTime()) / 86400000;
    if (diffDays > 31 && isValidDate(y - 1, month, day)) {
      iso = `${y - 1}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return iso;
}

function parseDate(ws: Workspace, today: string): string | null {
  // Relative dage
  const relative: Array<[RegExp, number]> = [
    [new RegExp(`${WORD_START}i\\s+forgårs${WORD_END}`), -2],
    [new RegExp(`${WORD_START}(?:i\\s+går|igår)${WORD_END}`), -1],
    [new RegExp(`${WORD_START}(?:i\\s+dag|idag)${WORD_END}`), 0],
    [new RegExp(`${WORD_START}(?:i\\s+morgen|imorgen)${WORD_END}`), 1],
  ];
  for (const [re, offset] of relative) {
    if (ws.take(re)) return addDays(today, offset);
  }

  // Ugedage: "i mandags"/"sidste mandag" = seneste forbigangne mandag;
  // "mandag"/"på mandag" = seneste mandag inkl. i dag (vi logger fortid).
  const weekdayAlt = Object.keys(WEEKDAYS).join("|");
  const todayDow = parseIsoDate(today).getUTCDay();
  const past = ws.take(
    new RegExp(
      `${WORD_START}(?:i\\s+(${weekdayAlt})s|(?:sidste|forrige)\\s+(${weekdayAlt}))${WORD_END}`,
    ),
  );
  if (past) {
    const dow = WEEKDAYS[past[1] ?? past[2]];
    const back = (todayDow - dow + 7) % 7 || 7;
    return addDays(today, -back);
  }
  const plain = ws.take(
    new RegExp(
      `${WORD_START}(?:(?:på|om|i)\\s+)?(${weekdayAlt})(?:s)?${WORD_END}`,
    ),
  );
  if (plain) {
    const dow = WEEKDAYS[plain[1]];
    return addDays(today, -((todayDow - dow + 7) % 7));
  }

  // "d. 3/10", "3/10-2026", "den 28/9". Et brøktal foran en varighedsenhed
  // ("1/2 time", "3/4 t") er ikke en dato — så lad varigheden om det.
  const slash = new RegExp(
    `${WORD_START}(?:(?:d\\.|den)\\s*)?(\\d{1,2})\\/(\\d{1,2})(?:[/-](\\d{2,4}))?${WORD_END}(?!\\s*(?:timer|time|tim|t|h|min|minutter|minut|m)${WORD_END})`,
  );
  const s = slash.exec(ws.work);
  if (s) {
    const iso = resolveDayMonth(
      today,
      Number(s[1]),
      Number(s[2]),
      s[3] ? Number(s[3]) : undefined,
    );
    if (iso) {
      ws.consume(s.index, s.index + s[0].length);
      return iso;
    }
  }

  // "3. oktober", "d. 3 okt"
  const named = new RegExp(
    `${WORD_START}(?:(?:d\\.|den)\\s*)?(\\d{1,2})\\.?\\s*(${MONTH_ALT})\\.?(?:\\s+(\\d{4}))?${WORD_END}`,
  );
  const n = named.exec(ws.work);
  if (n) {
    const month = MONTH_LOOKUP.get(n[2]);
    const iso = month
      ? resolveDayMonth(
          today,
          Number(n[1]),
          month,
          n[3] ? Number(n[3]) : undefined,
        )
      : null;
    if (iso) {
      ws.consume(n.index, n.index + n[0].length);
      return iso;
    }
  }

  // "d. 3.10" (kun med "d."/"den" foran — ellers kan det være 3,10 timer)
  const dotted = new RegExp(
    `${WORD_START}(?:d\\.|den)\\s*(\\d{1,2})\\.(\\d{1,2})\\.?(?:(\\d{2,4}))?${WORD_END}`,
  );
  const d = dotted.exec(ws.work);
  if (d) {
    const iso = resolveDayMonth(
      today,
      Number(d[1]),
      Number(d[2]),
      d[3] ? Number(d[3]) : undefined,
    );
    if (iso) {
      ws.consume(d.index, d.index + d[0].length);
      return iso;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tidsrum og varighed
// ---------------------------------------------------------------------------

interface Range {
  startTime: string;
  endTime: string;
  hours: number;
}

function parseRange(ws: Workspace): Range | null {
  const T = `(\\d{1,2})(?:[:.](\\d{2}))?`;
  const UNIT_AFTER = `(?!\\s*(?:timer|time|tim|t|h|min|minutter|minut|m)${WORD_END})`;
  const patterns = [
    // "kl. 9-11", "kl 9 til 11.30", "fra kl. 13 til 14", "fra 9 til 11"
    new RegExp(
      `${WORD_START}(?:fra\\s+)?(?:kl\\.?|klokken)\\s*${T}\\s*(?:-|–|til)\\s*(?:kl\\.?\\s*)?${T}${UNIT_AFTER}${WORD_END}`,
    ),
    new RegExp(
      `${WORD_START}fra\\s+${T}\\s*(?:-|–|til)\\s*(?:kl\\.?\\s*)?${T}${UNIT_AFTER}${WORD_END}`,
    ),
    // "9-11.30", "9:15-10" (uden kl. — kun når mindst én side har minutter,
    // så "2-3 timer" ikke tolkes som et tidsrum)
    new RegExp(
      `${WORD_START}(\\d{1,2})[:.](\\d{2})\\s*(?:-|–)\\s*${T}${UNIT_AFTER}${WORD_END}`,
    ),
    new RegExp(
      `${WORD_START}(\\d{1,2})()\\s*(?:-|–)\\s*(\\d{1,2})[:.](\\d{2})${UNIT_AFTER}${WORD_END}`,
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(ws.work);
    if (!m) continue;
    const sh = Number(m[1]);
    const sm = m[2] ? Number(m[2]) : 0;
    const eh = Number(m[3]);
    const em = m[4] ? Number(m[4]) : 0;
    if (sh > 23 || eh > 24 || sm > 59 || em > 59) continue;
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) minutes += 24 * 60; // over midnat
    ws.consume(m.index, m.index + m[0].length);
    return {
      startTime: `${pad2(sh)}:${pad2(sm)}`,
      endTime: `${pad2(eh % 24)}:${pad2(em)}`,
      hours: round2(minutes / 60),
    };
  }
  return null;
}

function parseDuration(ws: Workspace): number | null {
  let hours = 0;
  let found = false;
  const add = (h: number) => {
    if (Number.isFinite(h) && h > 0) {
      hours += h;
      found = true;
    }
  };
  const HOUR_UNIT = `(?:timer|time|tim|t|h)${WORD_END}`;
  const MIN_UNIT = `(?:minutter|minut|min|m)\\.?${WORD_END}`;

  // Brøker: "1/2 time", "3/4 t", "1/4 time"
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}(\\d{1,2})\\/(\\d{1,2})\\s*${HOUR_UNIT}`,
    ),
  )) {
    const denom = Number(m[2]);
    if (denom > 0) add(Number(m[1]) / denom);
  }
  // "1t30", "2t15m"
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}(\\d{1,2})[th](\\d{1,2})m?${WORD_END}`,
    ),
  )) {
    const min = Number(m[2]);
    if (min < 60) add(Number(m[1]) + min / 60);
  }
  // "1:30 timer"
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}(\\d{1,2}):(\\d{2})\\s*${HOUR_UNIT}`,
    ),
  )) {
    const min = Number(m[2]);
    if (min < 60) add(Number(m[1]) + min / 60);
  }
  // "to og en halv time", "2 og en halv timer", "2½ time"
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}${NUM}\\s*(?:og\\s+(?:en\\s+)?halv|½)\\s*${HOUR_UNIT}`,
    ),
  )) {
    add(toNumber(m[1]) + 0.5);
  }
  // "en halv time", "halv time" → 0,5 (efter "NUM og en halv")
  for (const _ of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}(?:(?:en|et|én)\\s+)?halv(?:t)?\\s+(?:time|timer)${WORD_END}`,
    ),
  )) {
    add(0.5);
  }
  // "tre kvarter", "et kvarter", "kvarter"
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}${WORD_START}(?:${NUM}\\s+)?kvarter(?:er)?${WORD_END}`,
    ),
  )) {
    add((m[1] ? toNumber(m[1]) : 1) * 0.25);
  }
  // "2 timer", "1,5 t", "en time", "halvanden time"
  for (const m of ws.takeAll(
    new RegExp(`${DURATION_PREFIX}${WORD_START}${NUM}\\s*${HOUR_UNIT}`),
  )) {
    add(toNumber(m[1]));
  }
  // "45 min", "ti minutter", "og 30 min" (i forlængelse af timer)
  for (const m of ws.takeAll(
    new RegExp(
      `${DURATION_PREFIX}(?:${WORD_START}og\\s+)?${WORD_START}${NUM}\\s*${MIN_UNIT}`,
    ),
  )) {
    add(toNumber(m[1]) / 60);
  }

  if (!found) return null;
  return round2(hours);
}

// ---------------------------------------------------------------------------
// Fuzzy-match af klient og projekt
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES = new Set([
  "aps",
  "as",
  "a/s",
  "ivs",
  "is",
  "i/s",
  "ks",
  "k/s",
  "ps",
  "p/s",
]);

/** Småord der aldrig alene må matche et navn */
const STOPWORDS = new Set([
  "til",
  "for",
  "på",
  "med",
  "og",
  "i",
  "en",
  "et",
  "den",
  "det",
  "de",
  "af",
  "at",
  "hos",
  "ved",
  "om",
  "fra",
  "kl",
  "har",
  "jeg",
  "vi",
  "log",
  "lidt",
  "noget",
  "om",
  "fik",
  "var",
  "er",
]);

/** Ord der kan stå foran et navn og hæve sikkerheden en smule */
const NAME_PREPOSITIONS = new Set(["til", "for", "hos", "med", "ved", "på"]);

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_SUFFIXES.has(w.replace(/[.,]$/, "")))
    .join(" ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Redigeringsafstand hvor en ombytning af to nabobogstaver ("kraen" ↔
 * "karen") tæller som én tastefejl (optimal string alignment).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[i][j] = i === 0 ? j : 0;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Antal tilladte tastefejl efter ordets længde */
function allowedTypos(len: number): number {
  if (len < 4) return 0;
  if (len < 8) return 1;
  return 2;
}

/** Ligner to normaliserede strenge hinanden? 1 = ens, 0 = nej */
function similarity(text: string, name: string): number {
  if (!text || !name) return 0;
  if (text === name) return 1;
  // Uden mellemrum: "jensen aps" vs "jensenaps", "web shop" vs "webshop"
  if (text.replace(/ /g, "") === name.replace(/ /g, "")) return 0.97;
  const dist = levenshtein(text, name);
  if (dist <= allowedTypos(name.length)) return 0.9 - dist * 0.05;
  return 0;
}

interface Token {
  norm: string;
  start: number;
  end: number;
  prevWord: string | null;
  /** Begyndte ordet med stort i originalteksten? (navne-signal) */
  capitalized: boolean;
}

function tokenize(work: string, original: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+(?:[&'./-][\p{L}\p{N}]+)*/gu;
  let prevWord: string | null = null;
  let lastEnd = 0;
  for (let m = re.exec(work); m; m = re.exec(work)) {
    // Kun ord der står lige efter hinanden (spiste dele bryder rækken)
    const gap = work.slice(lastEnd, m.index);
    const adjacentPrev =
      tokens.length > 0 && /^[\s,]*$/.test(gap) && gap.length < 3;
    const originalFirst = original[m.index] ?? "";
    tokens.push({
      norm: normalizeName(m[0]),
      start: m.index,
      end: m.index + m[0].length,
      prevWord: adjacentPrev ? prevWord : null,
      capitalized: originalFirst !== originalFirst.toLowerCase(),
    });
    prevWord = m[0].toLowerCase();
    lastEnd = m.index + m[0].length;
  }
  return tokens;
}

interface Match {
  id: string;
  name: string;
  score: number;
  start: number;
  end: number;
  /** Position inkl. en foranstillet præposition ("til Karen") */
  removeStart: number;
}

interface Named {
  id: string;
  name: string;
  /** Hele navne der skal matche som helhed (navn, firmanavn) */
  fullNames: string[];
}

function bestMatches(tokens: Token[], items: Named[]): Match[] {
  const byId = new Map<string, Match>();
  const maxN = 4;

  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= maxN && i + n <= tokens.length; n++) {
      // n-gram skal bestå af sammenhængende ord
      let contiguous = true;
      for (let k = i + 1; k < i + n; k++) {
        if (tokens[k].prevWord === null) contiguous = false;
      }
      if (!contiguous) break;
      const gram = tokens
        .slice(i, i + n)
        .map((t) => t.norm)
        .join(" ")
        .trim();
      if (!gram) continue;
      const words = gram.split(" ");
      if (words.every((w) => STOPWORDS.has(w) || /^\d+$/.test(w))) continue;

      const first = tokens[i];
      const last = tokens[i + n - 1];
      const prep =
        first.prevWord && NAME_PREPOSITIONS.has(first.prevWord)
          ? first.prevWord
          : null;

      for (const item of items) {
        let score = 0;
        for (const full of item.fullNames) {
          score = Math.max(score, similarity(gram, full));
        }
        // Del af navnet ("Karen" i "Karen Jensen", "Jensen" i "Jensen Byg").
        // Kun når ordet ligner et navn: skrevet med stort eller efter en
        // navne-præposition ("til Karen"). Uden den betingelse ville et
        // hvilket som helst almindeligt ord ("design", "test") ramme et
        // navne-fragment.
        if (
          score === 0 &&
          n === 1 &&
          gram.length >= 3 &&
          (first.capitalized || prep)
        ) {
          for (const full of item.fullNames) {
            for (const part of full.split(" ")) {
              if (part.length < 3 || STOPWORDS.has(part)) continue;
              const s = similarity(gram, part);
              if (s > 0) score = Math.max(score, s >= 1 ? 0.72 : 0.65);
            }
          }
        }
        if (score === 0) continue;
        if (prep) score += 0.05;
        // Flere ord matchet = mere sikkert
        score += (n - 1) * 0.01;

        const existing = byId.get(item.id);
        if (!existing || score > existing.score) {
          // Find præpositionens start, så "til Karen" fjernes samlet
          let removeStart = first.start;
          if (prep) {
            const before = tokens[i - 1];
            if (before) removeStart = before.start;
          }
          byId.set(item.id, {
            id: item.id,
            name: item.name,
            score: round2(score),
            start: first.start,
            end: last.end,
            removeStart,
          });
        }
      }
    }
  }

  const matches = [...byId.values()];
  // "Jensen Byg" matchet på to ord slår "Jensen" matchet på det ene — når det
  // længere, mindst lige så sikre match dækker det korte helt, er det korte
  // bare samme ord igen og skal ikke gøre valget tvetydigt.
  const kept = matches.filter(
    (b) =>
      !matches.some(
        (a) =>
          a !== b &&
          a.start <= b.start &&
          a.end >= b.end &&
          a.end - a.start > b.end - b.start &&
          a.score >= b.score,
      ),
  );
  return kept.sort((a, b) => b.score - a.score);
}

const MATCH_THRESHOLD = 0.6;
const AMBIGUITY_MARGIN = 0.05;

function pick(matches: Match[]): { winner: Match | null; candidates: Match[] } {
  const above = matches.filter((m) => m.score >= MATCH_THRESHOLD);
  if (above.length === 0) return { winner: null, candidates: [] };
  const [best, second] = above;
  const ambiguous = second && best.score - second.score < AMBIGUITY_MARGIN;
  return {
    winner: ambiguous ? null : best,
    candidates: above.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Beskrivelse
// ---------------------------------------------------------------------------

const LEADING_FILLER = new RegExp(
  `^(?:(?:log(?:ge)?|registrer|noter|skriv|tilføj|jeg|har|havde|brugt|brugte|lavet|lavede|arbejdet|arbejdede|med|på|til|for|i|om|et|en|og|,|-)${WORD_END}\\s*)+`,
  "i",
);
const TRAILING_FILLER =
  /(?:\s+|^)(?:på|til|for|i|med|om|og|hos|ved|fra|af|kl\.?|,|-|\.)\s*$/i;

function cleanDescription(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(LEADING_FILLER, "").trim();
    s = s.replace(TRAILING_FILLER, "").trim();
    s = s.replace(/^[,.;:\-–\s]+|[,.;:\-–\s]+$/g, "").trim();
  }
  // Dobbelte præpositioner efter fjernede navne: "møde med  om" → "møde om"
  s = s.replace(/\s+([,.])/g, "$1");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Hovedfunktion
// ---------------------------------------------------------------------------

export function parseFreetextEntry(
  text: string,
  ctx: FreetextContext,
): FreetextSuggestion {
  const ws = new Workspace(text.slice(0, 1000));

  const isBillable = parseBillable(ws);
  const parsedDate = parseDate(ws, ctx.today);
  const range = parseRange(ws);
  const duration = range ? null : parseDuration(ws);
  // Står både tidsrum og varighed, vinder tidsrummet — men varigheden må ikke
  // ende i beskrivelsen
  if (range) parseDuration(ws);

  const tokens = tokenize(ws.work, ws.original);

  // Klient først (navn + firmanavn)
  const clientItems: Named[] = ctx.clients.map((c) => ({
    id: c.id,
    name: c.name,
    fullNames: [c.name, c.company ?? ""]
      .map(normalizeName)
      .filter((s) => s.length > 0),
  }));
  const clientPick = pick(bestMatches(tokens, clientItems));
  const client = clientPick.winner;

  // Projekter: kun klientens egne, hvis klienten er fundet
  const projectPool = client
    ? ctx.projects.filter((p) => p.clientId === client?.id)
    : ctx.projects;
  const projectItems: Named[] = projectPool.map((p) => ({
    id: p.id,
    name: p.name,
    fullNames: [normalizeName(p.name)].filter((s) => s.length > 0),
  }));
  // Et projekt må ikke "genbruge" de ord, klienten blev fundet på
  const projectTokens = client
    ? tokens.filter(
        (t) =>
          t.end <= (client as Match).start || t.start >= (client as Match).end,
      )
    : tokens;
  const projectPick = pick(bestMatches(projectTokens, projectItems));
  const project = projectPick.winner;

  // Projekt uden klient: klienten følger projektet
  let clientId = client?.id ?? null;
  if (project && !client) {
    const proj = ctx.projects.find((p) => p.id === project.id);
    if (proj?.clientId) clientId = proj.clientId;
  }
  for (const m of [client, project]) {
    if (m) ws.consume(m.removeStart, m.end);
  }

  const description = cleanDescription(ws.remainder());
  const hours = range ? range.hours : duration;

  const missing: FreetextSuggestion["missing"] = [];
  if (hours === null) missing.push("hours");
  if (!clientId && !project) missing.push("client");

  const toCandidate = (m: Match): FreetextCandidate => ({
    id: m.id,
    name: m.name,
    score: m.score,
  });

  return {
    hours,
    date: parsedDate ?? ctx.today,
    dateFromText: parsedDate !== null,
    startTime: range?.startTime ?? null,
    endTime: range?.endTime ?? null,
    clientId,
    projectId: project?.id ?? null,
    clientCandidates: clientPick.candidates.map(toCandidate),
    projectCandidates: projectPick.candidates.map(toCandidate),
    isBillable,
    description,
    missing,
  };
}

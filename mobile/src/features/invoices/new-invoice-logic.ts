/**
 * Ren logik for at oprette en kladde med egne linjer på telefonen.
 *
 * Serverens `invoices.create` kender *kun* et beløb — den tager ingen
 * linjer. En kladde med manuelle linjer er derfor to kald: `create` med
 * summeringen, og bagefter `saveLines`, som erstatter hele linjelisten og
 * genberegner beløbet på serveren. Derfor:
 *
 *  1. `createPlan` laver begge kroppe fra ét sted, så beløbet i `create` er
 *     præcis det `saveLines` regner sig frem til. Ellers står der et beløb på
 *     kladden indtil næste gem.
 *  2. Uden kunde, uden brugbare linjer eller med et beløb på 0 ville zod
 *     afvise kaldet med en dansk fejl brugeren ikke kan handle på. Vi siger
 *     det i stedet, før der trykkes.
 *  3. Et *tabt svar* på `create` kan have oprettet kladden. Et nyt tryk ville
 *     så give to kladder, så et netværkssvigt fører brugeren til listen hvor
 *     den lander, i stedet for til et gentaget kald.
 *
 * Kladder bærer `UDKAST-` som nummer; det rigtige `INV-…` tildeles først ved
 * udstedelse. `getNextInvoiceNumber` er derfor en *forhåndsvisning* af det
 * nummer, kladden får den dag den sendes — aldrig en garanti.
 */
import type { DraftLine, SavedLine } from './invoice-lines-logic';
import { isNetworkFailure } from '~/lib/api/error-reporting';
import { findProblems, payloadKey, savedLines, totalOf } from './invoice-lines-logic';

export type CreateInput = {
  clientId: string;
  amount: string;
  issueDate: string;
  status: 'draft';
};

export type Blocker = 'no_client' | 'no_lines' | 'line_problem' | 'bad_total';

export type Plan
  = | { ok: true; create: CreateInput; lines: SavedLine[] }
    | { ok: false; blocker: Blocker };

/** Samme grænser som serverens `monetaryAmount` på `invoices.create`. */
const MAX_AMOUNT = 100_000_000;

export function createPlan(clientId: string | undefined, issueDate: string, lines: DraftLine[]): Plan {
  if (!clientId)
    return { ok: false, blocker: 'no_client' };
  // `findProblems` skelner et helt uberørt felt fra en linje der mangler
  // beskrivelse — kun den sidste ville få serveren til at afvise hele gemningen.
  if (savedLines(lines).length === 0)
    return { ok: false, blocker: 'no_lines' };
  if (findProblems(lines).length > 0)
    return { ok: false, blocker: 'line_problem' };

  const total = totalOf(lines);
  if (!(total > 0) || total > MAX_AMOUNT)
    return { ok: false, blocker: 'bad_total' };

  return {
    ok: true,
    create: { clientId, amount: total.toFixed(2), issueDate, status: 'draft' },
    lines: savedLines(lines),
  };
}

/**
 * Nøgle af det vi *ville* sende. Efter et tabt svar står den i skærmens
 * tilstand, og så længe formularen stadig ser sådan ud, er kaldet uafgjort —
 * se `retryAfterFailure`. Ændrer brugeren ét tegn, er det et nyt kladde-kald
 * og ikke et tabt svar, så advarslen forsvinder af sig selv.
 */
export function planKey(clientId: string | undefined, lines: DraftLine[]): string {
  return `${clientId ?? ''}|${payloadKey(lines)}`;
}

/**
 * Hvad et fejlet `create` betyder for næste tryk. Et netværkssvigt er
 * uafgjordigt: serveren kan have oprettet kladden, så brugeren skal se den
 * frem for at oprette en til. Alt andet (zod, 403, 500 med svar) er afgjort —
 * kaldet nåede ikke frem, eller det blev afvist.
 */
export function retryAfterFailure(error: unknown): 'create_again' | 'open_list' {
  return isNetworkFailure(error) ? 'open_list' : 'create_again';
}

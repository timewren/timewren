import type { CreateMeta, QueuedMutation } from './queue-logic';
import { isClientTooOld } from '~/lib/api/client-version';
import { isNetworkFailure } from '~/lib/api/error-reporting';
import { enqueueOffline, isOffline } from './enqueue';

export type SubmitResult = { kind: 'sent' } | { kind: 'queued' };

type Deps = {
  /** Sand når vi KUN ved vi er offline. Standard: onlineManager. */
  online?: () => boolean;
  enqueue?: (mutation: QueuedMutation) => void;
  /** Tidspunktet for det kald der sendes — stempler `firstAttemptAt`. */
  now?: () => string;
};

/**
 * En oprettelse der lå i køen efter et MISLYKKET kald kan allerede være gemt:
 * serveren kan have taget imod den, før forbindelsen brød. Uden dette flag
 * ville dræningen oprette den samme time igen, altså dobbeltfaktureret.
 *
 * `firstAttemptAt` er tidspunktet for kaldet vi netop sendte. Det afgør, hvilke
 * serverposter der overhovedet kan være vores, når dræningen slår dagen op —
 * uden det kan en ægte "1 t Support" tidligere samme dag sluge denne post.
 */
function markUnconfirmed(mutation: QueuedMutation, sentAt: string): QueuedMutation {
  if (mutation.type !== 'time.create')
    return mutation;
  const meta: CreateMeta = { ...mutation.meta, unconfirmed: true, firstAttemptAt: sentAt };
  return { ...mutation, meta };
}

/**
 * Kør en mutation mod serveren, og læg den i offline-køen i stedet for at
 * miste den, hvis der ikke er net.
 *
 * Netværksfejl er IKKE det samme som "vi ved vi er offline". `onlineManager`
 * afspejler kun det sidste netværks-event, så på en flosset forbindelse (tog,
 * kælder, mobilmast der hopper) står den på "online", kaldet fejler, og
 * brugeren taber sin registrering. Det er præcis den fejl der ikke må ske.
 *
 * KUN tabt forbindelse køes. En permanent afvisning (zod, manglende adgang)
 * er en reel fejl, brugeren skal se den, og en 5xx kan have oprettet posten —
 * begge kastes videre til kalderens egen fejlhåndtering.
 */
export async function runOrQueue(
  mutation: QueuedMutation,
  run: () => Promise<unknown>,
  deps: Deps = {},
): Promise<SubmitResult> {
  const online = deps.online ?? (() => !isOffline());
  const enqueue = deps.enqueue ?? enqueueOffline;
  const now = deps.now ?? (() => new Date().toISOString());

  if (!online()) {
    enqueue(mutation);
    return { kind: 'queued' };
  }
  try {
    await run();
    return { kind: 'sent' };
  }
  catch (error) {
    // For gammel app: serveren gemte intet. Posten venter i køen og sendes,
    // når appen er opdateret — i stedet for at gå tabt bag opdateringsbeskeden.
    if (isClientTooOld(error)) {
      enqueue(mutation);
      return { kind: 'queued' };
    }
    if (!isNetworkFailure(error))
      throw error;
    enqueue(markUnconfirmed(mutation, now()));
    return { kind: 'queued' };
  }
}

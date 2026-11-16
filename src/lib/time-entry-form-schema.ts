import { z } from "zod";

/** Valideringsbeskeder; dansk er standard, kaldere kan give oversatte tekster. */
export interface TimeEntrySchemaMessages {
  descriptionRequired: string;
  hoursMin: string;
  endAfterStart: string;
  pickProject: string;
  pickProjectOrClient: string;
}

const DEFAULT_MESSAGES: TimeEntrySchemaMessages = {
  descriptionRequired: "Beskrivelse er påkrævet",
  hoursMin: "Timer skal være mindst 0.01",
  endAfterStart: "Sluttid skal være efter starttid",
  pickProject: "Vælg et projekt",
  pickProjectOrClient: "Vælg enten et projekt eller en klient",
};

function createBaseTimeEntrySchema(messages: TimeEntrySchemaMessages) {
  return z.object({
    projectId: z.string().optional().or(z.literal("")),
    clientId: z.string().optional().or(z.literal("")),
    description: z.string().min(1, messages.descriptionRequired),
    notes: z.string().optional(),
    hours: z.number().min(0.01, messages.hoursMin),
    date: z.string(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    usePrepaid: z.boolean().optional(),
    prepaidPackageId: z.string().optional().or(z.literal("")),
  });
}

export const baseTimeEntrySchema = createBaseTimeEntrySchema(DEFAULT_MESSAGES);

export type TimeEntryForm = z.infer<typeof baseTimeEntrySchema>;

export interface TimeEntrySchemaModules {
  showClients: boolean;
  showProjects: boolean;
}

/**
 * Bygger valideringsschemaet for "Registrer tid" ud fra hvilke moduler
 * organisationen har slået til. Kunde-feltet er skjult når clients-modulet
 * er fra, så det må aldrig være et (usynligt) krav i den situation.
 */
export function buildTimeEntrySchema(
  { showClients, showProjects }: TimeEntrySchemaModules,
  messages: TimeEntrySchemaMessages = DEFAULT_MESSAGES,
) {
  // Ens start og slut er et tomt interval (0 t), ikke et døgn. Slut før start
  // er gyldigt og betyder næste dag.
  const withRange = createBaseTimeEntrySchema(messages).refine(
    (data) =>
      !data.startTime || !data.endTime || data.startTime !== data.endTime,
    { message: messages.endAfterStart, path: ["endTime"] },
  );
  if (!showProjects && !showClients) {
    return withRange;
  }
  if (!showClients) {
    return withRange.refine((data) => !!data.projectId, {
      message: messages.pickProject,
      path: ["projectId"],
    });
  }
  return withRange.refine((data) => data.projectId || data.clientId, {
    message: messages.pickProjectOrClient,
    path: ["projectId"],
  });
}

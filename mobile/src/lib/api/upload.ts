import { getApiUrl } from '~/features/server/server-config';
import { backendHeaders } from './trpc';

/**
 * Råt upload-endpoint. Det er **ikke** en tRPC-procedure: serveren har den som
 * `POST /api/upload/task-image` og bruger den til billeder, der ikke passer i en
 * JSON-body. Ruten er session-autoriseret via den samme cookie som tRPC, og den
 * komprimerer selv (sharp) og gemmer i S3 — klienten skal derfor ikke selv
 * komprimere, kun sørge for at sende jpeg.
 *
 * Se `src/features/tasks/attachment-logic.ts` for resten af kontrakten.
 */
const TASK_IMAGE_URL = `${getApiUrl()}/api/upload/task-image`;

export async function postTaskImage(body: FormData) {
  // React Native sætter boundary selv, så Content-Type må IKKE sættes manuelt.
  return fetch(TASK_IMAGE_URL, { method: 'POST', headers: await backendHeaders(), body });
}

import type { TxKeyPath } from '~/lib/i18n';

/**
 * Billed-upload til en opgave.
 *
 * Serveren (`/api/upload/task-image`) er den eneste, der gemmer filen: den
 * komprimerer med sharp til jpeg og lægger den i S3. Klienten sender derfor den
 * rå fil, men **altid** som jpeg — web'ens `compressImage` laver den konvertering
 * i browseren, og det kan vi ikke. Et iPhone-foto er som regel HEIC, som
 * serveren afviser med 400, så konverteringen skal ske i appen.
 */

/**
 * Formater appen kan åbne. Bemærk `heic`/`heif`: de er *ikke* på serverens
 * liste, men appen konverterer dem til jpeg inden upload, så de er gyldige her.
 * Serverens egen liste er i `api/upload/task-image/route.ts`.
 */
export const PICKABLE_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
];

/** Serveren svarer altid `image/jpeg`, uanset hvad klienten sendte. */
export const UPLOADED_CONTENT_TYPE = 'image/jpeg';

export type PickedImage = { uri: string; fileName: string | null; mimeType: string | null };

export type UploadedImage = { url: string; fileName: string; sizeBytes: number };

export type AttachmentError
  = | 'unsupported'
    | 'rejected'
    | 'upload_failed'
    | 'bad_response'
    | 'missing_url';

export type UploadOutcome
  = | { ok: true; image: UploadedImage }
    | { ok: false; kind: AttachmentError };

export function errorTx(kind: AttachmentError): TxKeyPath {
  return `tasks.attachments_error.${kind}` as TxKeyPath;
}

/** Kan appen åbne denne filtype overhovedet? Udelukker bl.a. PDF og video. */
export function isPickableImageType(mimeType: string | null | undefined): boolean {
  if (!mimeType)
    return false;
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return PICKABLE_IMAGE_TYPES.includes(base);
}

const HTTPS_RE = /^https:\/\/\S+$/;

/** Kun https. En attachment-URL er en URL, appen indlejrer i et billede. */
export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && HTTPS_RE.test(value);
}

export type FileDescriptor = { uri: string; name: string; type: string };

/**
 * Filen som React Native's fetch vil have den. RN kalder den "descriptor" — det
 * er ikke en Blob, og derfor kan den ikke testes via FormData (jest-miljøets
 * FormAppendedValue laver en streng af den). Derfor er den sin egen rene funktion.
 */
export function fileDescriptor(picked: PickedImage): FileDescriptor {
  return {
    uri: picked.uri,
    name: picked.fileName?.trim() || 'vedhaeftning.jpg',
    type: UPLOADED_CONTENT_TYPE,
  };
}

function buildForm(file: FileDescriptor): FormData {
  const form = new FormData();
  form.append('file', file as unknown as Blob);
  return form;
}

/**
 * Svaret fra upload-endpointet er upålideligt input: det kan være en fejlside,
 * en proxy-500 eller `{}`. Uden `url` kan vi ikke vedhæfte noget, så kaldet skal
 * fejle **før** mutationen — ellers gemmer serveren en post med en billed-URL,
 * appen ikke kan vise, og brugeren tror billedet er væk.
 */
export function parseUploadResponse(body: unknown): UploadedImage | null {
  if (typeof body !== 'object' || body === null)
    return null;
  const { url, fileName, sizeBytes } = body as Record<string, unknown>;
  if (!isHttpsUrl(url))
    return null;
  return {
    url,
    fileName: typeof fileName === 'string' && fileName.length > 0 ? fileName : 'billede.jpg',
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
  };
}

export type UploadDeps = {
  /** Selve netkaldet, indsprøjt i tests. Skal kaste ved netfejl. */
  post: (body: FormData) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
};

/**
 * Upload ét jpeg-billede (allerede konverteret) og returnér klar til
 * `tasks.addAttachment`.
 *
 * Kaster aldrig: netfejl, HTTP-fejl og et ubrugeligt svar bliver alle et
 * `ok: false`, så skærmen kan vise én dansk besked i stedet for en rå fejl.
 */
export async function uploadTaskImage(picked: PickedImage, deps: UploadDeps): Promise<UploadOutcome> {
  if (!picked.uri)
    return { ok: false, kind: 'unsupported' };

  let response: Awaited<ReturnType<UploadDeps['post']>>;
  try {
    response = await deps.post(buildForm(fileDescriptor(picked)));
  }
  catch {
    return { ok: false, kind: 'upload_failed' };
  }

  // 400 er serverens egen afvisning: filtype eller størrelse. Den skal siges
  // tydeligt, for det er den eneste fejl brugeren selv kan rette.
  if (!response.ok)
    return { ok: false, kind: response.status === 400 ? 'rejected' : 'upload_failed' };

  let body: unknown;
  try {
    body = await response.json();
  }
  catch {
    return { ok: false, kind: 'bad_response' };
  }

  if (typeof body === 'object' && body !== null && 'url' in body && !isHttpsUrl((body as { url: unknown }).url))
    return { ok: false, kind: 'missing_url' };

  const image = parseUploadResponse(body);
  return image ? { ok: true, image } : { ok: false, kind: 'bad_response' };
}

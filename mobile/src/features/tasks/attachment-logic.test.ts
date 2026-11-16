import type { PickedImage, UploadDeps } from './attachment-logic';
import {
  fileDescriptor,
  isHttpsUrl,
  isPickableImageType,
  parseUploadResponse,
  PICKABLE_IMAGE_TYPES,
  uploadTaskImage,
} from './attachment-logic';

const JPEG: PickedImage = { uri: 'file:///tmp/a.jpg', fileName: 'besog.jpg', mimeType: 'image/jpeg' };

type Post = UploadDeps['post'];

function postReturning(body: unknown, init: { ok?: boolean; status?: number } = {}): Post {
  return jest.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }));
}

function postThrowingJson(): Post {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  }));
}

function postThrowing(): Post {
  return jest.fn(async () => {
    throw new TypeError('Network request failed');
  });
}

describe('isPickableImageType', () => {
  it('accepterer de fire servertyper plus heic, som appen selv konverterer', () => {
    for (const type of PICKABLE_IMAGE_TYPES)
      expect(isPickableImageType(type)).toBe(true);
  });

  it('afviser formater appen ikke kan åbne, og ukendte typer', () => {
    expect(isPickableImageType('application/pdf')).toBe(false);
    expect(isPickableImageType('video/mp4')).toBe(false);
    expect(isPickableImageType(null)).toBe(false);
    expect(isPickableImageType('')).toBe(false);
  });

  it('normaliserer casing og parametre', () => {
    expect(isPickableImageType('IMAGE/HEIC')).toBe(true);
    expect(isPickableImageType('image/jpeg; charset=binary')).toBe(true);
  });
});

describe('isHttpsUrl', () => {
  it('accepterer kun https', () => {
    expect(isHttpsUrl('https://mahope.hel1.your-objectstorage.com/a/b.jpg')).toBe(true);
    expect(isHttpsUrl('http://mahope.hel1.your-objectstorage.com/a/b.jpg')).toBe(false);
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
    expect(isHttpsUrl(42)).toBe(false);
  });
});

describe('parseUploadResponse', () => {
  it('læser et gyldigt svar', () => {
    expect(parseUploadResponse({ url: 'https://x.dk/a.jpg', fileName: 'a.jpg', sizeBytes: 10 }))
      .toEqual({ url: 'https://x.dk/a.jpg', fileName: 'a.jpg', sizeBytes: 10 });
  });

  it('stopper ved en URL, der ikke er https — den ville blive indlejret i et billede', () => {
    expect(parseUploadResponse({ url: 'http://evil.dk/a.jpg' })).toBeNull();
    expect(parseUploadResponse({ url: 'data:image/png;base64,AAA' })).toBeNull();
  });

  it('afviser alt der ikke er et JSON-objekt med en URL', () => {
    expect(parseUploadResponse(null)).toBeNull();
    expect(parseUploadResponse('ok')).toBeNull();
    expect(parseUploadResponse([{ url: 'https://x.dk/a.jpg' }])).toBeNull();
    expect(parseUploadResponse({})).toBeNull();
  });

  it('giver fornuftige standarder for manglende filnavn og umulig størrelse', () => {
    expect(parseUploadResponse({ url: 'https://x.dk/a.jpg' }))
      .toEqual({ url: 'https://x.dk/a.jpg', fileName: 'billede.jpg', sizeBytes: 0 });
    expect(parseUploadResponse({ url: 'https://x.dk/a.jpg', fileName: '', sizeBytes: -1 }))
      .toEqual({ url: 'https://x.dk/a.jpg', fileName: 'billede.jpg', sizeBytes: 0 });
    expect(parseUploadResponse({ url: 'https://x.dk/a.jpg', sizeBytes: Number.NaN }))
      .toEqual({ url: 'https://x.dk/a.jpg', fileName: 'billede.jpg', sizeBytes: 0 });
  });
});

describe('fileDescriptor', () => {
  it('sender altid filen som jpeg, uanset hvad pickeren rapporterede', () => {
    // Serveren afviser alt andet end fire typer, og sharp gemmer altid jpeg.
    expect(fileDescriptor({ uri: 'file:///tmp/a.heic', fileName: 'IMG_1.HEIC', mimeType: 'image/heic' }))
      .toEqual({ uri: 'file:///tmp/a.heic', name: 'IMG_1.HEIC', type: 'image/jpeg' });
  });

  it('giver et filnavn, også når pickerens er tomt eller mangler', () => {
    expect(fileDescriptor({ uri: 'a.jpg', fileName: '   ', mimeType: 'image/jpeg' }).name).toBe('vedhaeftning.jpg');
    expect(fileDescriptor({ uri: 'a.jpg', fileName: null, mimeType: 'image/jpeg' }).name).toBe('vedhaeftning.jpg');
    expect(fileDescriptor({ uri: 'a.jpg', fileName: '  kunde.jpg  ', mimeType: 'image/jpeg' }).name).toBe('kunde.jpg');
  });
});

describe('uploadTaskImage', () => {
  it('uploader billedet og returnerer klar data', async () => {
    const post = postReturning({ url: 'https://x.dk/a.jpg', fileName: 'besog.jpg', sizeBytes: 512 });
    const outcome = await uploadTaskImage(JPEG, { post });
    expect(outcome).toEqual({ ok: true, image: { url: 'https://x.dk/a.jpg', fileName: 'besog.jpg', sizeBytes: 512 } });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('sender præcis ét felt ved navn "file" — serveren læser kun det', async () => {
    const post = postReturning({ url: 'https://x.dk/a.jpg' });
    await uploadTaskImage(JPEG, { post });
    const form = (post as jest.Mock).mock.calls[0][0] as FormData;
    expect([...form.keys()]).toEqual(['file']);
  });

  it('afviser en fil uden uri, uden at sende noget', async () => {
    const post = postReturning({ url: 'https://x.dk/a.jpg' });
    expect(await uploadTaskImage({ uri: '', fileName: 'a.jpg', mimeType: 'image/jpeg' }, { post })).toEqual({ ok: false, kind: 'unsupported' });
    expect(post).not.toHaveBeenCalled();
  });

  it('melder netfejl som upload_failed i stedet for at kaste', async () => {
    expect(await uploadTaskImage(JPEG, { post: postThrowing() })).toEqual({ ok: false, kind: 'upload_failed' });
  });

  it('skelner serverens egen afvisning (400) fra en fejl', () => {
    // 400 = filtype eller størrelse. Det er den eneste fejl brugeren selv kan rette,
    // så den må ikke stå som "upload_failed" og få ham til at prøve igen blindt.
    const rejected = postReturning({ error: 'Invalid file type' }, { ok: false, status: 400 });
    const tooBig = postReturning({ error: 'File too large (max 10 MB)' }, { ok: false, status: 400 });
    const unauthorized = postReturning({ error: 'Unauthorized' }, { ok: false, status: 401 });
    const serverError = postReturning({}, { ok: false, status: 500 });
    return Promise.all([
      expect(uploadTaskImage(JPEG, { post: rejected })).resolves.toEqual({ ok: false, kind: 'rejected' }),
      expect(uploadTaskImage(JPEG, { post: tooBig })).resolves.toEqual({ ok: false, kind: 'rejected' }),
      expect(uploadTaskImage(JPEG, { post: unauthorized })).resolves.toEqual({ ok: false, kind: 'upload_failed' }),
      expect(uploadTaskImage(JPEG, { post: serverError })).resolves.toEqual({ ok: false, kind: 'upload_failed' }),
    ]);
  });

  it('stopper ved et svar json() ikke kan læse, så vi ikke gemmer en post appen ikke kan vise', async () => {
    // Fx en fejlside der svarer 200 med HTML.
    expect(await uploadTaskImage(JPEG, { post: postThrowingJson() })).toEqual({ ok: false, kind: 'bad_response' });
  });

  it('stopper ved et 200-svar uden brugbar URL', async () => {
    const post = postReturning({ error: 'No file provided' });
    expect(await uploadTaskImage(JPEG, { post })).toEqual({ ok: false, kind: 'bad_response' });
  });

  it('skelner en URL, der findes, men ikke er https', async () => {
    const post = postReturning({ url: 'http://x.dk/a.jpg' });
    expect(await uploadTaskImage(JPEG, { post })).toEqual({ ok: false, kind: 'missing_url' });
  });
});

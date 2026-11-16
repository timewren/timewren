import { TRPCClientError } from '@trpc/client';
import { APP_STORE_URL, PLAY_STORE_URL, storeUrl } from '~/features/more/links';
import { clearClientTooOld, CLIENT_HEADER, CLIENT_VERSION, clientVersionHeaders, formatMobileClientVersion, isClientTooOld, isGuardedWrite, markClientTooOld, useClientTooOld } from './client-version';

function trpcError(data: Record<string, unknown>) {
  return TRPCClientError.from({ error: { message: 'x', code: -32000, data } } as never);
}

describe('formatMobileClientVersion', () => {
  it('sender version + numerisk build', () => {
    expect(formatMobileClientVersion('1.0.0', '5')).toBe('mobile/1.0.0+5');
  });

  it('udelader et build, der ikke er numerisk (serveren kan ikke sammenligne det)', () => {
    expect(formatMobileClientVersion('1.0.0', null)).toBe('mobile/1.0.0');
    expect(formatMobileClientVersion('1.0.0', '1.0.0')).toBe('mobile/1.0.0');
    expect(formatMobileClientVersion('1.0.0', '')).toBe('mobile/1.0.0');
  });
});

describe('clientVersionHeaders', () => {
  it('sender x-timetrack-client i serverens format', () => {
    expect(CLIENT_HEADER).toBe('x-timetrack-client');
    expect(clientVersionHeaders()[CLIENT_HEADER]).toBe(CLIENT_VERSION);
    expect(CLIENT_VERSION).toMatch(/^mobile\/\d+(\.\d+){0,3}(\+\d+)?$/);
  });
});

describe('isClientTooOld', () => {
  it('genkender serverens appCode', () => {
    expect(isClientTooOld(trpcError({ code: 'PRECONDITION_FAILED', httpStatus: 412, appCode: 'CLIENT_TOO_OLD' }))).toBe(true);
  });

  it('andre fejl er ikke "for gammel"', () => {
    expect(isClientTooOld(trpcError({ code: 'PRECONDITION_FAILED', httpStatus: 412 }))).toBe(false);
    expect(isClientTooOld(trpcError({ code: 'BAD_REQUEST', httpStatus: 400 }))).toBe(false);
    expect(isClientTooOld(new Error('Network request failed'))).toBe(false);
    expect(isClientTooOld(null)).toBe(false);
  });
});

describe('markClientTooOld', () => {
  it('slår den blokerende besked til', () => {
    expect(useClientTooOld.getState().tooOld).toBe(false);
    markClientTooOld();
    expect(useClientTooOld.getState().tooOld).toBe(true);
  });

  it('lukkes igen, når en beskyttet skrivning går igennem', () => {
    markClientTooOld();
    clearClientTooOld();
    expect(useClientTooOld.getState().tooOld).toBe(false);
  });
});

describe('isGuardedWrite', () => {
  it('kun mutationer på time.* og timerSync.* er versionstjekket', () => {
    expect(isGuardedWrite('time.create', 'mutation')).toBe(true);
    expect(isGuardedWrite('timerSync.sync', 'mutation')).toBe(true);
    expect(isGuardedWrite('time.list', 'query')).toBe(false);
    expect(isGuardedWrite('clients.create', 'mutation')).toBe(false);
  });
});

describe('storeUrl', () => {
  it('peger på App Store på iOS og Google Play ellers', () => {
    expect(storeUrl('ios')).toBe(APP_STORE_URL);
    expect(storeUrl('android')).toBe(PLAY_STORE_URL);
    expect(PLAY_STORE_URL).toContain('id=dk.timetrack.app');
  });
});

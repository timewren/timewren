import { readyForPushPrompt } from './push-timing';

const inside = { signedIn: true, isFirstTime: false, onboardingCompleted: true, isAdmin: true };

describe('readyForPushPrompt', () => {
  it('spørger, når brugeren er logget ind og inde i appen', () => {
    expect(readyForPushPrompt(inside)).toBe(true);
  });

  it('venter, mens opsætningen af en ny organisation står på skærmen', () => {
    expect(readyForPushPrompt({ ...inside, onboardingCompleted: false })).toBe(false);
  });

  it('spørger et medlem, der ikke selv skal igennem opsætningen', () => {
    expect(readyForPushPrompt({ ...inside, onboardingCompleted: false, isAdmin: false })).toBe(true);
  });

  it('venter på velkomsten og på profilen', () => {
    expect(readyForPushPrompt({ ...inside, isFirstTime: true })).toBe(false);
    expect(readyForPushPrompt({ ...inside, onboardingCompleted: undefined })).toBe(false);
    expect(readyForPushPrompt({ ...inside, signedIn: false })).toBe(false);
  });
});

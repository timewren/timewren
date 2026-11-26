/* eslint-disable ts/ban-ts-comment */
/* eslint-disable no-restricted-globals */

// Mock react-native-worklets first
jest.mock('react-native-worklets', () => ({
  __esModule: true,
  default: {},
}));

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const View = require('react-native').View;

  return {
    __esModule: true,
    default: {
      View,
      ScrollView: View,
      createAnimatedComponent: (component: any) => component,
    },
    useSharedValue: jest.fn(() => ({ value: 0 })),
    useAnimatedStyle: jest.fn(fn => fn()),
    withTiming: jest.fn(value => value),
    withSpring: jest.fn(value => value),
    withDecay: jest.fn(value => value),
    withDelay: jest.fn((_, value) => value),
    withRepeat: jest.fn(value => value),
    withSequence: jest.fn((...values) => values[0]),
    cancelAnimation: jest.fn(),
    Easing: {
      linear: jest.fn(),
      ease: jest.fn(),
      quad: jest.fn(),
      cubic: jest.fn(),
      bezier: jest.fn(),
      in: jest.fn(fn => fn),
      out: jest.fn(fn => fn),
      inOut: jest.fn(fn => fn),
    },
    FadeIn: { duration: jest.fn(() => ({})) },
    FadeOut: { duration: jest.fn(() => ({})) },
    FadeInDown: { duration: jest.fn(() => ({})) },
    FadeInUp: { duration: jest.fn(() => ({})) },
    FadeInLeft: { duration: jest.fn(() => ({})) },
    FadeInRight: { duration: jest.fn(() => ({})) },
    SlideInDown: { duration: jest.fn(() => ({})) },
    SlideInUp: { duration: jest.fn(() => ({})) },
    SlideInLeft: { duration: jest.fn(() => ({})) },
    SlideInRight: { duration: jest.fn(() => ({})) },
    Layout: {},
    Keyframe: jest.fn(),
  };
});

// Mock expo-localization
jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [
    {
      languageTag: 'en-US',
      languageCode: 'en',
      textDirection: 'ltr',
      digitGroupingSeparator: ',',
      decimalSeparator: '.',
      measurementSystem: 'metric',
      currencyCode: 'USD',
      currencySymbol: '$',
      regionCode: 'US',
    },
  ]),
}));

// Mock react-native-mmkv
jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    getNumber: jest.fn(),
    getBoolean: jest.fn(),
    delete: jest.fn(),
    clearAll: jest.fn(),
    getAllKeys: jest.fn(() => []),
  })),
  useMMKVString: jest.fn((_key: string) => [undefined, jest.fn()]),
  useMMKVNumber: jest.fn((_key: string) => [undefined, jest.fn()]),
  useMMKVBoolean: jest.fn((_key: string) => [undefined, jest.fn()]),
  useMMKVObject: jest.fn((_key: string) => [undefined, jest.fn()]),
  createMMKV: jest.fn(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    getNumber: jest.fn(),
    getBoolean: jest.fn(),
    delete: jest.fn(),
    clearAll: jest.fn(),
    getAllKeys: jest.fn(() => []),
  })),
}));

// Global window object setup for React Native testing
// @ts-expect-error
global.window = {};

// @ts-expect-error
global.window = global;

// waitFor/findBy venter som standard kun 1 s, hvilket ikke holder på en belastet CI-runner.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });

// Nodes ægte `clearImmediate` tæller sin interne immediate-tæller ned for ethvert objekt,
// den får, også en falsk timer fra `jest.useFakeTimers()`. Afmonteres en komponent efter
// `jest.useRealTimers()` (fx `StatusBar`, der rydder sin falske immediate), løber tælleren
// under nul. Tælleren gælder hele worker-processen, så en senere testfil i samme worker
// kan hænge i `afterEach`: står der præcis lige så mange ægte immediates i kø, som tælleren
// er skæv, tror Node, at der ingen er, og kører dem først, når en timer vækker loopet.
// Sådan hang recurring-edit-route 20/11-26 efter flex-screen i samme worker. Vagten sender
// kun ægte immediates videre og får den test, der afmonterer for sent, til at fejle her.
// Registreres efter RNTL, så RNTL's automatiske oprydning er kørt, når vagten tjekker.
const nodeClearImmediate = clearImmediate;
const probeImmediate = setImmediate(() => {});
const NodeImmediate = probeImmediate.constructor;
nodeClearImmediate(probeImmediate);
const foreignClears = new Set<string>();

globalThis.clearImmediate = ((handle?: NodeJS.Immediate) => {
  if (handle && !(handle instanceof NodeImmediate)) {
    foreignClears.add(expect.getState().currentTestName ?? expect.getState().testPath ?? 'ukendt test');
    return;
  }
  nodeClearImmediate(handle);
}) as typeof clearImmediate;

function assertNoForeignClears() {
  if (foreignClears.size === 0)
    return;
  const tests = [...foreignClears].join(', ');
  foreignClears.clear();
  throw new Error(
    `clearImmediate fik en falsk timer efter jest.useRealTimers() (${tests}). `
    + 'En komponent blev afmonteret med andre timere end dem, den startede med. '
    + 'Vent på afmonteringen (await cleanupAsync()), før de ægte timere slås til igen.',
  );
}

afterEach(assertNoForeignClears);
afterAll(assertNoForeignClears);

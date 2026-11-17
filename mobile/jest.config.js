const path = require('node:path');
const { cacheKey } = require('./scripts/babel-direct-imports');

module.exports = {
  preset: 'jest-expo',
  // I projektet, så CI kan gemme cachen; babel-direct-imports er ikke en del af babel-jests cachenøgle.
  cacheDirectory: path.join(__dirname, 'node_modules/.cache/jest', cacheKey),
  roots: ['<rootDir>/src', '<rootDir>/__mocks__', '<rootDir>/scripts'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/', '<rootDir>/ios/', '<rootDir>/android/'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  globalSetup: '<rootDir>/scripts/jest-timezone.js',
  testMatch: ['**/?(*.)+(spec|test).ts?(x)'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!**/coverage/**',
    '!**/node_modules/**',
    '!**/babel.config.js',
    '!**/jest-setup.ts',
  ],
  moduleFileExtensions: ['js', 'mjs', 'ts', 'tsx'],
  transform: {
    '^.+\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    `node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|@sentry/.*|native-base|react-native-svg|@gorhom/.*|@shopify/.*|@tanstack/.*|react-native-reanimated|react-native-mmkv|react-native-nitro-modules|react-native-worklets|moti|zustand|tailwind-merge|tailwind-variants|uniwind|superjson|@trpc/.*|better-auth|@better-auth/.*|@better-fetch/.*|nanostores|lucide-react-native|date-fns|copy-anything|is-what))`,
  ],
  coverageReporters: ['json-summary', ['text', { file: 'coverage.txt' }]],
  reporters: [
    'default',
    ['github-actions', { silent: false }],
    'summary',
    [
      'jest-junit',
      {
        outputDirectory: 'coverage',
        outputName: 'jest-junit.xml',
        ancestorSeparator: ' › ',
        uniqueOutputName: 'false',
        suiteNameTemplate: '{filepath}',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
      },
    ],
  ],
  coverageDirectory: '<rootDir>/coverage/',
  moduleNameMapper: {
    '(^|/)auth/client$': '<rootDir>/__mocks__/auth-client.ts',
    '^@better-auth/expo/client$': '<rootDir>/__mocks__/better-auth-expo-client.ts',
    '^~/(.*)$': '<rootDir>/src/$1',
    // Web-repoets kode (paritetstests), som tsconfig's `@/*`.
    '^@/(.*)$': '<rootDir>/../src/$1',
  },
};

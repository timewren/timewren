module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
    ],
    plugins: [
      // Før module-resolver: direkte filer i stedet for barrel-imports (se filen).
      './scripts/babel-direct-imports',
      [
        'module-resolver',
        {
          root: ['./'],
          alias: {
            '~': './src',
            '@env': './src/lib/env.js',
          },
          extensions: [
            '.ios.ts',
            '.android.ts',
            '.ts',
            '.ios.tsx',
            '.android.tsx',
            '.tsx',
            '.jsx',
            '.js',
            '.json',
          ],
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};

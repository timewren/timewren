import { transformSync } from '@babel/core';

import directImports from './babel-direct-imports';

function transform(code: string) {
  return transformSync(code, {
    filename: 'file.tsx',
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript'] },
    plugins: [directImports],
  })?.code;
}

describe('babel-direct-imports', () => {
  it('rewrites lucide icons, including aliases, to their icon file', () => {
    expect(transform(`import { CalendarDays, ClockIcon as C } from 'lucide-react-native';`)).toBe(
      'import CalendarDays from "lucide-react-native/icons/calendar-days";\n'
      + 'import C from "lucide-react-native/icons/clock";',
    );
  });

  it('rewrites date-fns functions and locales to their subpath', () => {
    expect(transform(`import { addDays, format as dfFormat } from 'date-fns';\nimport { da, de } from 'date-fns/locale';`)).toBe(
      'import { addDays } from "date-fns/addDays";\n'
      + 'import { format as dfFormat } from "date-fns/format";\n'
      + 'import { da } from "date-fns/locale/da";\n'
      + 'import { de } from "date-fns/locale/de";',
    );
  });

  it('keeps type-only specifiers on the original import', () => {
    expect(transform(`import { Clock, type LucideIcon } from 'lucide-react-native';`)).toBe(
      'import Clock from "lucide-react-native/icons/clock";\n'
      + 'import { type LucideIcon } from \'lucide-react-native\';',
    );
  });

  it('leaves the whole import alone when a name cannot be resolved', () => {
    const imports = [
      `import { Clock, Icon } from 'lucide-react-native';`,
      `import { formatDate } from 'date-fns';`,
      `import * as icons from 'lucide-react-native';`,
      `import type { LucideIcon } from 'lucide-react-native';`,
      `import { View } from 'react-native';`,
    ];
    for (const code of imports)
      expect(transform(code)).toBe(code);
  });
});

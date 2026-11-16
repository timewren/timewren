import { checkFile, findJsxTags, parseImports } from './check-classname.mjs';

describe('check-classname', () => {
  it('parses default, named and aliased imports', () => {
    const imports = parseImports(`
      import Svg, { Path as P } from 'react-native-svg';
      import { Text as NNText, View } from 'react-native';
      import type { Foo } from './foo';
    `);
    expect(imports.get('Svg')).toEqual({ source: 'react-native-svg', imported: 'Svg' });
    expect(imports.get('P')).toEqual({ source: 'react-native-svg', imported: 'Path' });
    expect(imports.get('NNText')).toEqual({ source: 'react-native', imported: 'Text' });
    expect(imports.get('View')).toEqual({ source: 'react-native', imported: 'View' });
  });

  it('finds multi-line tags and ignores > inside {} expressions', () => {
    const tags = findJsxTags(`
      <MotiView
        onPress={() => go(a > b)}
        className="p-2"
      >
        <Text className="x">hej</Text>
      </MotiView>
    `);
    expect(tags.map(t => t.name)).toEqual(['MotiView', 'Text']);
    expect(tags[0].attrs).toContain('className="p-2"');
    expect(tags[0].line).toBe(2);
  });

  it('ignores className on nested JSX inside prop expressions', () => {
    const code = `
      import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
      import { Text } from 'react-native';
      export function X() {
        return (
          <BottomSheetFlatList
            data={[]}
            ListEmptyComponent={(<Text className="p-4">tom</Text>)}
          />
        );
      }
    `;
    expect(checkFile(code)).toEqual([]);
  });

  it('flags third-party components but not RN core, aliases, own or local ones', () => {
    const code = `
      import { MotiView } from 'moti';
      import { Link } from 'expo-router';
      import { Text as NNText, View } from 'react-native';
      import { Card } from '~/components/ui';
      import { withUniwind } from 'uniwind';
      const AnimatedView = withUniwind(Animated.View);
      export function X() {
        return (
          <View className="a">
            <NNText className="b" />
            <Card className="c" />
            <AnimatedView className="d" />
            <MotiView className="e" />
            <Link href="/" className="f" />
            <Link href="/" asChild><View className="g" /></Link>
          </View>
        );
      }
    `;
    const findings = checkFile(code);
    expect(findings.map(f => f.name)).toEqual(['MotiView', 'Link']);
    expect(findings[0].source).toBe('moti');
  });
});

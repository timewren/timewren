import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { offlineReads } from '~/lib/api/offline-read-runtime';
import { translate } from '~/lib/i18n';
import { ProjectPickerModal } from './project-picker-modal';

jest.mock('~/lib/api/trpc', () => ({
  trpc: {
    clients: { list: { useQuery: () => ({}) } },
    projects: { list: { useQuery: () => ({}) } },
  },
}));
jest.mock('~/lib/api/offline-read-storage', () => ({
  offlineReadDisk: { read: () => undefined, write: jest.fn(), remove: jest.fn() },
}));
jest.mock('~/lib/notify', () => ({ useAnnounceVisible: jest.fn() }));
jest.mock('~/components/ui/bottom-sheet', () => ({
  BottomSheetTextInput: require('react-native').TextInput,
}));
jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetFlatList: require('react-native').FlatList,
}));
jest.mock('~/components/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    colors: { neutral: {} },
    Text,
    ColorDot: () => null,
    EmptyState: () => null,
    Modal: ({ title, children }: { title: string; children: React.ReactNode }) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    ListRow: ({ title, onPress, testID }: { title: string; onPress: () => void; testID: string }) => (
      <Pressable onPress={onPress} testID={testID}><Text>{title}</Text></Pressable>
    ),
  };
});

it.each(['expiry', 'scope change'])('drops a mounted customer selection at %s', (reason) => {
  jest.useFakeTimers();
  onlineManager.setOnline(false);
  const owner = offlineReads.activate({
    server: 'https://example.test',
    user: 'a',
    organization: 'org-a',
    session: 'proof',
    expiresAt: Date.now() + 1000,
  });
  offlineReads.save(owner, ['clients.list', { includeArchived: false }], [{ id: 'old', name: 'Saved customer' }]);
  const onSelect = jest.fn();
  const { unmount } = render(<ProjectPickerModal ref={React.createRef<BottomSheetModal>()} onSelect={onSelect} />);
  try {
    fireEvent.press(screen.getByTestId('picker-client-old'));
    expect(screen.getByText('Saved customer')).toBeOnTheScreen();
    expect(screen.getByTestId('picker-client-only')).toBeOnTheScreen();

    act(() => {
      if (reason === 'expiry')
        jest.advanceTimersByTime(1000);
      else
        offlineReads.activate({ ...owner, organization: 'org-b' });
    });

    expect(screen.getByText(translate('timer.pick_client'))).toBeOnTheScreen();
    expect(screen.queryByText('Saved customer')).toBeNull();
    expect(screen.queryByTestId('picker-client-only')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  }
  finally {
    unmount();
    offlineReads.clear();
    onlineManager.setOnline(true);
    jest.useRealTimers();
  }
});

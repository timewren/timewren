import { cleanupAsync } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import RecurringEditRoute from '~/app/recurring/[id]';
import i18n from '~/lib/i18n';

const mockGetById = jest.fn((..._args: unknown[]) => ({
  data: undefined,
  isError: false,
  isLoading: false,
  isPaused: true,
  isPending: true,
}));

jest.mock('~/components/ui', () => ({
  ...jest.requireActual('~/components/ui/screen'),
  ListSkeleton: () => null,
}));

jest.mock('~/lib/api', () => ({
  trpc: {
    recurring: {
      getById: { useQuery: (...args: unknown[]) => mockGetById(...args) },
      list: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

it('viser redigeringsoverskriften ved et offline deep link uden cache', async () => {
  const language = i18n.language;
  await i18n.changeLanguage('da');
  try {
    renderRouter({ 'recurring/[id]': RecurringEditRoute }, {
      initialUrl: '/recurring/template-1',
    });

    expect(mockGetById).toHaveBeenCalledWith({ id: 'template-1' }, { enabled: true });
    expect(screen.getByRole('header', { name: 'Redigér skabelon' })).toBeVisible();
  }
  finally {
    // `renderRouter` slår falske timere til. Afmontér og vent på det, før de ægte
    // timere kommer tilbage, så intet rydder op med andre timere end dem, det startede med.
    await cleanupAsync();
    jest.useRealTimers();
    await i18n.changeLanguage(language);
  }
});

import * as React from 'react';
import { Alert } from 'react-native';
import { translate } from '~/lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { DeleteAccountScreen } from './delete-account-screen';

const mockOpenSubscriptionStore = jest.fn(async () => {});
const mockConfig: { current: { data?: unknown } } = { current: {} };
const mockCalls: string[] = [];
const mockMutateAsync = jest.fn(async () => {
  mockCalls.push('deleteAccount');
});
const mockRunOrgSteps = jest.fn(async () => {
  mockCalls.push('runOrgSteps');
});
const mockOrgs: { current: { data?: unknown; isLoading: boolean; isError?: boolean; refetch?: () => void } } = { current: { data: [], isLoading: false } };
const mockSubmitFeedback = jest.fn(async (_input: { message: string }) => {
  mockCalls.push('feedback');
});
const mockDeletionInfo: { current: { data?: { storeSubscription: unknown }; isSuccess?: boolean; isError?: boolean; refetch?: () => void } } = { current: { data: { storeSubscription: null }, isSuccess: true } };

jest.mock('~/lib/api', () => ({
  errorMessage: () => 'fejl',
  trpc: {
    user: {
      deleteAccount: { useMutation: () => ({ mutateAsync: mockMutateAsync, isPending: false }) },
      getAccountDeletionInfo: { useQuery: () => mockDeletionInfo.current },
    },
  },
  trpcClient: { feedback: { submit: { mutate: (input: { message: string }) => mockSubmitFeedback(input) } } },
}));
jest.mock('~/features/auth/use-auth-store', () => ({
  signOut: jest.fn(),
  useAuthStore: { use: { session: () => ({ user: { id: 'u-me', email: 'demo@example.com' } }) } },
}));
jest.mock('~/features/billing/store-billing-api', () => ({ useStoreBillingConfig: () => mockConfig.current }));
jest.mock('~/features/billing/use-store-billing', () => ({
  openSubscriptionStore: (...args: unknown[]) => mockOpenSubscriptionStore(...(args as [])),
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => mockOrgs.current }));
jest.mock('./account-deletion-orgs', () => ({
  ...jest.requireActual('./account-deletion-orgs'),
  loadOrgsWithMembers: jest.fn(),
  runOrgSteps: (...args: unknown[]) => mockRunOrgSteps(...(args as [])),
}));
const mockAppleCode: { current: string | null | 'canceled' } = { current: null };
jest.mock('~/lib/auth/apple', () => ({ appleCodeForAccountDeletion: async () => mockAppleCode.current }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: mockReplace }) }));

function withSource(source: string, productId: string | null = null) {
  mockConfig.current = {
    data: { current: { source, planTier: 'privat', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, productId } },
  };
}

describe('slet konto med et abonnement fra butikken', () => {
  afterEach(cleanup);

  it.each([
    ['apple', 'dk.timetrack.app.privat.monthly', 'settings.delete_account.store_body_apple'],
    ['google', 'privat', 'settings.delete_account.store_body_google'],
  ] as const)('siger tydeligt, at et %s-abonnement ikke stopper, og giver en vej til butikken', (source, productId, body) => {
    withSource(source, productId);
    render(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.store_title'))).toBeOnTheScreen();
    expect(screen.getByText(translate(body))).toBeOnTheScreen();
    // Den almindelige advarsel lover ikke, at abonnementet opsiges.
    expect(screen.queryByText(translate('settings.delete_account.warning_body'))).toBeNull();

    fireEvent.press(screen.getByTestId('delete-account-manage-subscription'));
    expect(mockOpenSubscriptionStore).toHaveBeenCalledWith(source, productId);
  });

  it.each(['web', 'none'])('viser ingen butiksadvarsel ved source %s', (source) => {
    withSource(source);
    render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-store-subscription')).toBeNull();
    expect(screen.getByText(translate('settings.delete_account.warning_body'))).toBeOnTheScreen();
  });

  it('viser ingen butiksadvarsel, før serverens svar er kommet', () => {
    mockConfig.current = {};
    render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-store-subscription')).toBeNull();
  });
});

describe('slet konto, når brugeren deler organisation med andre', () => {
  afterEach(() => {
    cleanup();
    mockCalls.length = 0;
    mockOrgs.current = { data: [], isLoading: false };
    mockDeletionInfo.current = { data: { storeSubscription: null }, isSuccess: true };
    mockMutateAsync.mockClear();
    mockRunOrgSteps.mockClear();
    mockSubmitFeedback.mockClear();
    mockReplace.mockClear();
    mockAppleCode.current = null;
    jest.restoreAllMocks();
  });

  const team = {
    id: 'org-1',
    name: 'Demo ApS',
    members: [
      { id: 'm-me', userId: 'u-me', role: 'owner' },
      { id: 'm-2', userId: 'u-2', role: 'member' },
      { id: 'm-3', userId: 'u-3', role: 'member' },
    ],
  };

  it('viser, at organisationen slettes, når brugeren er eneste ejer', () => {
    mockConfig.current = {};
    mockOrgs.current = { data: [team], isLoading: false };
    render(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.org_delete', { name: 'Demo ApS', count: 2 }))).toBeOnTheScreen();
  });

  it('viser intet om organisationer for en bruger uden team', () => {
    mockConfig.current = {};
    render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-orgs')).toBeNull();
  });

  it('rydder organisationerne, før kontoen slettes', async () => {
    mockConfig.current = {};
    mockOrgs.current = { data: [team], isLoading: false };
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    fireEvent.press(screen.getByTestId('delete-account-submit'));
    await waitFor(() => expect(mockCalls).toHaveLength(2));
    expect(mockRunOrgSteps).toHaveBeenCalledWith([{ kind: 'remove-members', orgId: 'org-1', name: 'Demo ApS', memberIds: ['m-2', 'm-3'] }]);
    expect(mockCalls).toEqual(['runOrgSteps', 'deleteAccount']);
    // Efter sletningen sendes brugeren væk fra den døde sletteskærm.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  function confirmAndSubmit() {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    fireEvent.press(screen.getByTestId('delete-account-submit'));
  }

  // Serveren forlader selv teamet og anonymiserer brugeren (web #918), så et teammedlem
  // sletter kontoen direkte i appen i stedet for at sende en anmodning (App Store 5.1.1(v)).
  it('lader et teammedlem slette kontoen direkte, når brugeren ikke er eneste ejer', async () => {
    mockConfig.current = {};
    mockOrgs.current = {
      data: [{ id: 'org-2', name: 'Kunde A/S', members: [{ id: 'b', userId: 'u-boss', role: 'owner' }, { id: 'me', userId: 'u-me', role: 'member' }] }],
      isLoading: false,
    };
    render(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.org_leave', { name: 'Kunde A/S' }))).toBeOnTheScreen();
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockCalls).toEqual(['runOrgSteps', 'deleteAccount']);
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('bekræfter et butiksabonnement, som kun serveren kender (anden organisation end den aktive)', async () => {
    mockConfig.current = {};
    mockDeletionInfo.current = { data: { storeSubscription: { id: 's1' } }, isSuccess: true };
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync).toHaveBeenCalledWith({ confirmEmail: 'demo@example.com', storeSubscriptionAcknowledged: true });
  });

  it('kan ikke slette, når organisationerne ikke kunne hentes', () => {
    mockConfig.current = {};
    mockOrgs.current = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    expect(screen.getByText(translate('settings.delete_account.orgs_error'))).toBeOnTheScreen();
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
  });

  it('kan ikke slette, før serveren har svaret om butiksabonnementer', () => {
    mockConfig.current = {};
    mockDeletionInfo.current = { isSuccess: false, isError: true, refetch: jest.fn() };
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
  });
});

describe('slet konto med Apple-login', () => {
  beforeEach(() => mockReplace.mockClear());
  afterEach(() => {
    cleanup();
    mockCalls.length = 0;
    mockMutateAsync.mockClear();
    mockAppleCode.current = null;
    jest.restoreAllMocks();
  });

  function confirmAndSubmit() {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find(b => b.style === 'destructive')?.onPress?.();
    });
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    fireEvent.press(screen.getByTestId('delete-account-submit'));
  }

  // Apple 5.1.1(v): Apple-login skal tilbagekaldes. Det native login gemmer intet token på
  // serveren, så appen henter en frisk kode fra Apple, som serveren veksler og tilbagekalder.
  it('sender en frisk Apple-kode med, så serveren kan tilbagekalde Apple-login', async () => {
    mockConfig.current = {};
    mockAppleCode.current = 'apple-code-123';
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync).toHaveBeenCalledWith({ confirmEmail: 'demo@example.com', appleAuthorizationCode: 'apple-code-123' });
  });

  it('sletter ikke, når brugeren lukker Apple-arket', async () => {
    mockConfig.current = {};
    mockAppleCode.current = 'canceled';
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await new Promise(resolve => setTimeout(resolve, 0));
    // Afbrudt før noget er rørt: ingen medlemmer fjernet, ingen sletning.
    expect(mockCalls).toEqual([]);
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

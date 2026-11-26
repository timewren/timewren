import * as React from 'react';
import { Alert } from 'react-native';
import { signOut } from '~/features/auth/use-auth-store';
import { translate } from '~/lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '~/lib/test-utils';
import { DeleteAccountScreen } from './delete-account-screen';

const mockOpenSubscriptionStore = jest.fn(async () => {});
const mockConfig: { current: { data?: unknown } } = { current: {} };
const mockCalls: string[] = [];
const mockMutateAsync = jest.fn(async () => {
  mockCalls.push('deleteAccount');
});
const mockFetch = jest.fn();
const mockShowMessage = jest.fn();
const mockOrgs: { current: { data?: unknown; isLoading: boolean; isError?: boolean; refetch?: () => void } } = { current: { data: [], isLoading: false, refetch: jest.fn() } };
const mockSubmitFeedback = jest.fn(async (_input: { message: string }) => {
  mockCalls.push('feedback');
});
const mockDeletionInfo: { current: { data?: { storeSubscription: unknown; canDelete?: boolean; blockingOrgs?: { id: string; name: string }[] }; isSuccess?: boolean; isError?: boolean; refetch?: () => void } } = { current: { data: { storeSubscription: null, canDelete: true }, isSuccess: true, refetch: jest.fn() } };

jest.mock('~/lib/api', () => ({
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
}));
jest.mock('~/lib/auth/client', () => ({ authClient: { $fetch: (...args: unknown[]) => mockFetch(...args) } }));
jest.mock('~/lib/notify', () => ({ showMessage: (...args: unknown[]) => mockShowMessage(...args) }));
const mockAppleCode = jest.fn<Promise<string | null>, []>(async () => null);
jest.mock('~/lib/auth/apple', () => ({ appleCodeForAccountDeletion: () => mockAppleCode() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockAppleCode.mockReset().mockResolvedValue(null);
  mockConfig.current = {};
  mockCalls.length = 0;
  mockOrgs.current = { data: [], isLoading: false, refetch: jest.fn() };
  mockDeletionInfo.current = { data: { storeSubscription: null, canDelete: true }, isSuccess: true, refetch: jest.fn() };
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: mockReplace }) }));

function withSource(source: string, productId: string | null = null) {
  mockConfig.current = {
    data: { current: { source, planTier: 'privat', status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false, productId } },
  };
}

function confirmAndSubmit() {
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find(b => b.style === 'destructive')?.onPress?.();
  });
  fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
  fireEvent.press(screen.getByTestId('delete-account-submit'));
}

describe('slet konto med et abonnement fra butikken', () => {
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
    render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-store-subscription')).toBeNull();
  });
});

describe('slet konto, når brugeren deler organisation med andre', () => {
  const team = {
    id: 'org-1',
    name: 'Demo ApS',
    members: [
      { id: 'm-me', userId: 'u-me', role: 'owner' },
      { id: 'm-2', userId: 'u-2', role: 'member' },
      { id: 'm-3', userId: 'u-3', role: 'member' },
    ],
  };

  it('blokerer sletning for eneejeren uden at ændre teamets medlemskaber', () => {
    mockOrgs.current = { data: [team], isLoading: false, refetch: jest.fn() };
    mockDeletionInfo.current = {
      data: { storeSubscription: null, canDelete: false, blockingOrgs: [team] },
      isSuccess: true,
    };
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    expect(screen.getByText(translate('settings.delete_account.org_transfer', { name: team.name }))).toBeOnTheScreen();
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
    expect(screen.getByText('Your account will be permanently deleted. If you have an active subscription, it will be cancelled.')).toBeOnTheScreen();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockAppleCode).not.toHaveBeenCalled();
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('følger serverens sletteplan, når den accepterer en delt konto med rollen admin,owner', async () => {
    mockOrgs.current = {
      data: [{ ...team, members: team.members.map(m => m.userId === 'u-me' ? { ...m, role: 'admin,owner' } : m) }],
      isLoading: false,
    };
    render(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.org_leave', { name: team.name }))).toBeOnTheScreen();
    confirmAndSubmit();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('viser intet om organisationer for en bruger uden team', () => {
    render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-orgs')).toBeNull();
  });

  // Serveren forlader selv teamet og anonymiserer brugeren (web #918), så et teammedlem
  // sletter kontoen direkte i appen i stedet for at sende en anmodning (App Store 5.1.1(v)).
  it.each(['member', 'owner'])('lader en %s slette, mens serveren bevarer teamets data anonymiseret', async (role) => {
    mockOrgs.current = {
      data: [{ id: 'org-2', name: 'Kunde A/S', members: [{ id: 'b', userId: 'u-boss', role: 'owner' }, { id: 'me', userId: 'u-me', role }] }],
      isLoading: false,
      refetch: jest.fn(),
    };
    render(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.org_leave', { name: 'Kunde A/S' }))).toBeOnTheScreen();
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(Alert.alert).toHaveBeenCalledWith(
      expect.any(String),
      'Your account will be permanently deleted. This cannot be undone.',
      expect.any(Array),
    );
    expect(mockCalls).toEqual(['deleteAccount']);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });

  it('bevarer session og medlemskaber ved serverfejl efter en forældet sletteplan', async () => {
    const refetchInfo = jest.fn();
    mockDeletionInfo.current = { data: { storeSubscription: null, canDelete: true }, isSuccess: true, refetch: refetchInfo };
    mockOrgs.current = {
      data: [{ ...team, members: team.members.map(m => m.id === 'm-2' ? { ...m, role: 'owner' } : m) }],
      isLoading: false,
      refetch: jest.fn(),
    };
    mockMutateAsync.mockRejectedValueOnce(new Error('Organisation changed during deletion'));
    const { rerender } = render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(refetchInfo).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockShowMessage).toHaveBeenCalledWith({
      message: translate('settings.delete_account.retry_error'),
      type: 'danger',
    });

    mockDeletionInfo.current = {
      data: { storeSubscription: null, canDelete: false, blockingOrgs: [team] },
      isSuccess: true,
    };
    rerender(<DeleteAccountScreen />);
    expect(screen.getByText(translate('settings.delete_account.org_transfer', { name: team.name }))).toBeOnTheScreen();
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
  });

  it('bekræfter et butiksabonnement, som kun serveren kender (anden organisation end den aktive)', async () => {
    mockDeletionInfo.current = { data: { storeSubscription: { id: 's1' }, canDelete: true }, isSuccess: true };
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync).toHaveBeenCalledWith({ confirmEmail: 'demo@example.com', storeSubscriptionAcknowledged: true });
  });
});

describe('forudsætninger for kontosletning', () => {
  it('kan ikke slette, når organisationerne ikke kunne hentes', () => {
    mockOrgs.current = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    expect(screen.getByText(translate('settings.delete_account.orgs_error'))).toBeOnTheScreen();
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
  });

  it('kan ikke slette, før serveren har svaret om butiksabonnementer', () => {
    mockDeletionInfo.current = { isSuccess: false, isError: true, refetch: jest.fn() };
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    expect(screen.getByTestId('delete-account-submit')).toBeDisabled();
  });
});

describe('slet konto med Apple-login', () => {
  // Apple 5.1.1(v): Apple-login skal tilbagekaldes. Det native login gemmer intet token på
  // serveren, så appen henter en frisk kode fra Apple, som serveren veksler og tilbagekalder.
  it('sender en frisk Apple-kode med, så serveren kan tilbagekalde Apple-login', async () => {
    mockAppleCode.mockResolvedValue('apple-code-123');
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync).toHaveBeenCalledWith({ confirmEmail: 'demo@example.com', appleAuthorizationCode: 'apple-code-123' });
  });

  it('bevarer sessionen ved en serverfejl og henter en ny Apple-kode ved næste forsøg', async () => {
    mockAppleCode.mockResolvedValueOnce('first-code').mockResolvedValueOnce('second-code');
    mockMutateAsync.mockRejectedValueOnce(new Error('Server failure'));
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(mockShowMessage).toHaveBeenCalledWith({
      message: translate('settings.delete_account.retry_error'),
      type: 'danger',
    }));
    expect(mockMutateAsync).toHaveBeenNthCalledWith(1, { confirmEmail: 'demo@example.com', appleAuthorizationCode: 'first-code' });
    expect(signOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockShowMessage).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByTestId('delete-account-submit')).toBeEnabled());
    fireEvent.press(screen.getByTestId('delete-account-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockAppleCode).toHaveBeenCalledTimes(2);
    expect(mockMutateAsync).toHaveBeenNthCalledWith(2, { confirmEmail: 'demo@example.com', appleAuthorizationCode: 'second-code' });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('ignorerer gentagne bekræftelser, mens sletningen kører og efter succes', async () => {
    const confirm = jest.fn();
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      confirm.mockImplementation(buttons?.find(b => b.style === 'destructive')?.onPress ?? (() => {}));
      confirm();
      confirm();
    });
    render(<DeleteAccountScreen />);
    fireEvent.changeText(screen.getByTestId('delete-account-email'), 'demo@example.com');
    fireEvent.press(screen.getByTestId('delete-account-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    confirm();
    expect(mockAppleCode).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockShowMessage).toHaveBeenCalledTimes(1);
  });

  it('sletter ikke, når brugeren lukker Apple-arket', async () => {
    mockAppleCode.mockResolvedValue('canceled');
    render(<DeleteAccountScreen />);
    confirmAndSubmit();
    await waitFor(() => expect(screen.getByTestId('delete-account-submit')).toBeEnabled());
    // Afbrudt før noget er rørt: ingen medlemmer fjernet, ingen sletning.
    expect(mockCalls).toEqual([]);
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

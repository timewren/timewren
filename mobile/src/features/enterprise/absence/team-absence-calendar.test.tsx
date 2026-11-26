import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import i18n from '~/lib/i18n';
import { AbsenceScreen } from './absence-screen';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('~/components/ui/screen', () => ({
  Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) => (
    <>
      {header}
      {children}
    </>
  ),
}));
jest.mock('./components/enterprise-gate', () => ({
  EnterpriseGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('./absence-overview', () => ({ AbsenceOverview: () => null }));
jest.mock('./absence-requests', () => ({ AbsenceRequests: () => null }));
jest.mock('./absence-approve', () => ({ AbsenceApprove: () => null }));
jest.mock('~/features/enterprise/inbox/use-inbox', () => ({ useInboxUnreadCount: () => 0 }));
jest.mock('~/features/capabilities/use-capabilities', () => ({
  isDefaultOrgName: () => false,
  useCapabilities: jest.fn(),
}));
jest.mock('~/features/auth/use-auth-store', () => ({ useAuthStore: () => null }));
jest.mock('~/lib/api', () => ({
  trpc: {
    useUtils: jest.fn(),
    enterprise: { listRequests: { useQuery: jest.fn() } },
  },
}));

const useQuery = jest.mocked(trpc.enterprise.listRequests.useQuery);
const useCaps = jest.mocked(useCapabilities);
const refetch = jest.fn();
type QueryResult = ReturnType<typeof useQuery>;

function mockRole(flags: { isManager?: boolean; isHr?: boolean } = {}) {
  useCaps.mockReturnValue({ isManager: false, isHr: false, ...flags } as ReturnType<typeof useCaps>);
}

function mockApproved(result: Partial<Pick<QueryResult, 'fetchStatus' | 'isLoading' | 'isError'>> & { data?: unknown[] } = {}) {
  useQuery.mockImplementation(input => ({
    refetch,
    ...(typeof input === 'object' && input?.status === 'approved' ? result : {}),
  }) as unknown as QueryResult);
}

function openTeam() {
  render(<AbsenceScreen />);
  fireEvent.press(screen.getByRole('tab', { name: i18n.t('enterprise.absence.tab_team') }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('da');
  jest.useFakeTimers({ now: new Date(2028, 0, 15) });
  mockRole({ isManager: true });
  mockApproved();
});

afterEach(() => jest.useRealTimers());

it('does not offer or query the team calendar for employees', () => {
  mockRole();
  render(<AbsenceScreen />);
  expect(screen.queryByRole('tab', { name: 'Team' })).toBeNull();
  expect(useQuery.mock.calls).toEqual([[{ status: 'pending' }, { enabled: false }]]);
});

it('lets HR read the calendar without enabling approvals', () => {
  mockRole({ isHr: true });
  openTeam();
  expect(screen.queryByTestId('absence-tabs-approve')).toBeNull();
  expect(useQuery).toHaveBeenCalledWith({ status: 'pending' }, { enabled: false });
  expect(useQuery).toHaveBeenCalledWith({ status: 'approved' });
});

it('shows the server-masked type and clips it again when the manager changes month', () => {
  mockApproved({
    data: [{
      id: 'period-a',
      userId: 'employee-a',
      user: { name: 'Medarbejder A' },
      startDate: '2027-12-30',
      endDate: '2028-01-04',
      absenceType: { name: 'Fravær', color: '#6b7280', category: 'sickness' },
      note: 'Privat testnote',
    }],
  });

  openTeam();
  expect(useQuery).toHaveBeenCalledWith({ status: 'approved' });
  expect(screen.getByText('Medarbejder A')).toBeTruthy();
  expect(screen.getByText(/^Fravær\s+1–4$/)).toBeTruthy();
  expect(screen.queryByText(/sickness|Privat testnote/)).toBeNull();

  fireEvent.press(screen.getByRole('button', { name: i18n.t('common.previous_month') }));
  expect(screen.getByText('december 2027')).toBeTruthy();
  expect(screen.getByText(/^Fravær\s+30–31$/)).toBeTruthy();
});

it('opens in the Danish month and includes today in ongoing absences', () => {
  jest.setSystemTime(new Date('2028-01-31T23:30:00Z'));
  mockApproved({
    data: [{
      id: 'period-a',
      userId: 'employee-a',
      user: { name: 'Medarbejder A' },
      startDate: '2028-01-30',
      endDate: null,
      absenceType: { name: 'Fravær', color: null },
    }],
  });

  openTeam();
  expect(screen.getByText('februar 2028')).toBeTruthy();
  expect(screen.getByText(/^Fravær\s+1$/)).toBeTruthy();
});

it('extends an ongoing absence when Danish midnight passes with the calendar open', () => {
  jest.setSystemTime(new Date('2028-02-01T22:59:00Z'));
  mockApproved({
    data: [{
      id: 'period-a',
      userId: 'employee-a',
      user: { name: 'Medarbejder A' },
      startDate: '2028-02-01',
      endDate: null,
      absenceType: { name: 'Fravær', color: null },
    }],
  });

  openTeam();
  expect(screen.getByText(/^Fravær\s+1$/)).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(60_000);
  });
  expect(screen.getByText(/^Fravær\s+1–2$/)).toBeTruthy();
});

it('distinguishes a paused first fetch from a confirmed empty month', () => {
  mockApproved({ fetchStatus: 'paused', isLoading: false, isError: false });
  openTeam();
  expect(screen.queryByText(i18n.t('enterprise.absence.team_calendar_empty'))).toBeNull();
  expect(screen.getByText(i18n.t('enterprise.absence.team_calendar_offline'))).toBeTruthy();
});

it('shows loading until the query resolves', () => {
  mockApproved({ isLoading: true });
  openTeam();
  expect(screen.getByTestId('team-absence-loading')).toBeTruthy();
  expect(screen.queryByText(i18n.t('enterprise.absence.team_calendar_empty'))).toBeNull();
});

it('offers a retry when the query fails', () => {
  mockApproved({ isError: true });
  openTeam();
  expect(screen.queryByText(i18n.t('enterprise.absence.team_calendar_empty'))).toBeNull();
  fireEvent.press(screen.getByTestId('retry'));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it.each([
  { language: 'da', tab: 'Team', month: 'januar 2028', empty: 'Intet godkendt teamfravær i denne måned' },
  { language: 'en', tab: 'Team', month: 'January 2028', empty: 'No approved team absences this month' },
  { language: 'de', tab: 'Team', month: 'Januar 2028', empty: 'Keine genehmigten Abwesenheiten im Team in diesem Monat' },
  { language: 'es', tab: 'Equipo', month: 'enero 2028', empty: 'No hay ausencias aprobadas en el equipo este mes' },
])('renders the empty calendar in $language', async ({ language, tab, month, empty }) => {
  await i18n.changeLanguage(language);
  mockApproved({ data: [] });
  render(<AbsenceScreen />);
  fireEvent.press(screen.getByRole('tab', { name: tab }));
  expect(screen.getByText(month)).toBeTruthy();
  expect(screen.getByText(empty)).toBeTruthy();
});

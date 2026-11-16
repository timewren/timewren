import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { TeamMember } from '../team-logic';
import * as React from 'react';
import i18n from '~/lib/i18n';
import { fireEvent, screen, setup } from '~/lib/test-utils';
import { MemberSheet } from './member-sheet';

/**
 * Genåbning af en godkendt uge kræver en begrundelse på serveren (web #756,
 * `MIN_UNLOCK_REASON` = 3 tegn). Uden den afviser `reopenTimesheetWeek` kaldet,
 * så arket må hverken sende uden begrundelse eller sende den utrimmet.
 */

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    enterprise: {
      getTimesheetWeekEvents: { useQuery: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: jest.fn() }) },
    },
  },
}));

const APPROVED: TeamMember = {
  userId: 'u1',
  profileId: null,
  name: 'Mette',
  email: 'mette@example.dk',
  image: null,
  departmentId: null,
  total: 37,
  norm: 37,
  perDay: null,
  absenceByDay: {},
  completeness: null,
  weekStatus: 'approved',
  submittedAt: null,
  rejectionReason: null,
};

function Harness({ onReopen }: { onReopen: jest.Mock }) {
  const ref = React.useRef<BottomSheetModal | null>(null);
  React.useEffect(() => {
    ref.current?.present();
  }, []);
  return (
    <MemberSheet
      ref={ref}
      member={APPROVED}
      balances={undefined}
      days={null}
      weekStart="2026-09-28"
      isManager
      isSelf={false}
      busy={false}
      onApprove={jest.fn()}
      onReject={jest.fn()}
      onReopen={onReopen}
    />
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

describe('genåbning af en godkendt uge', () => {
  it('kræver mindst tre tegns begrundelse og sender den trimmet', () => {
    const onReopen = jest.fn();
    setup(<Harness onReopen={onReopen} />);

    fireEvent.press(screen.getByTestId('reopen'));
    expect(onReopen).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('reopen-reason'), '  ab  ');
    fireEvent.press(screen.getByTestId('reopen-confirm'));
    expect(onReopen).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('reopen-reason'), '  Glemt sygedag  ');
    fireEvent.press(screen.getByTestId('reopen-confirm'));
    expect(onReopen).toHaveBeenCalledWith('u1', 'Glemt sygedag');
  });
});

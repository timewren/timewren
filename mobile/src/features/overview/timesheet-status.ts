export type WeekStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

/** Kladde/indsendt/godkendt/afvist — null fra serveren betyder kladde. */
export function timesheetStatus(status: string | null | undefined): WeekStatus {
  if (status === 'submitted' || status === 'approved' || status === 'rejected')
    return status;
  return 'draft';
}

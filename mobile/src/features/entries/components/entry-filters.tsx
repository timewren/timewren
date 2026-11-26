import type { BillableMode, BilledMode, EntryFilter } from '../entry-filter';
import * as React from 'react';
import { Select } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { ALL_BILLABLE, ALL_BILLED, ALL_PROJECTS } from '../entry-filter';

type EntryFiltersProps = {
  filter: EntryFilter;
  onChange: (filter: EntryFilter) => void;
  projects: { id: string; name: string }[];
  projectsError: boolean;
};

/**
 * Projekt- og fakturerbar-vælgeren i Tid-skærmens header.
 *
 * Bevidst uden eget kald: `projects` kommer ind som props, så komponenten ikke
 * henter noget og derfor ikke skal melde sit kald til skærmens indlæsningsstop.
 * Begge vælgere har "alle"-valget først, så valget selv er nulstillingen — der
 * skal ikke være en separat knap ved siden af.
 */
export function EntryFilters({ filter, onChange, projects, projectsError }: EntryFiltersProps) {
  // "Alle projekter" ligger først, så valget også ER nulstillingen — brugeren
  // behøver ikke en separat knap for at komme tilbage til hele perioden.
  const projectOptions = React.useMemo(() => [
    { label: translate('entries.all_projects'), value: ALL_PROJECTS },
    ...projects.map(p => ({ label: p.name, value: p.id })),
  ], [projects]);

  const billableOptions = React.useMemo(() => [
    { label: translate('entries.all_billable'), value: ALL_BILLABLE },
    { label: translate('entries.billable_only'), value: 'billable' },
    { label: translate('entries.non_billable_only'), value: 'non-billable' },
  ], []);

  const billedOptions = React.useMemo(() => [
    { label: translate('entries.all_billed'), value: ALL_BILLED },
    { label: translate('entries.billed_only'), value: 'billed' },
    { label: translate('entries.unbilled_only'), value: 'unbilled' },
  ], []);

  return (
    <>
      <Select
        label={translate('entries.filter_project')}
        options={projectOptions}
        value={filter.projectId}
        onSelect={v => onChange({ ...filter, projectId: String(v) })}
        error={projectsError ? translate('common.error_load') : undefined}
        placeholder={translate(filter.projectId ? 'entries.selected_project' : 'entries.all_projects')}
        testID="time-project"
      />
      <Select
        label={translate('entries.filter_billable')}
        options={billableOptions}
        value={filter.billable}
        onSelect={v => onChange({ ...filter, billable: String(v) as BillableMode })}
        placeholder={translate('entries.all_billable')}
        testID="time-billable"
      />
      <Select
        label={translate('entries.filter_billed')}
        options={billedOptions}
        value={filter.billed}
        onSelect={v => onChange({ ...filter, billed: String(v) as BilledMode })}
        placeholder={translate('entries.all_billed')}
        testID="time-billed"
      />
    </>
  );
}

import type { ProjectStatus } from './project-logic';
import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { blankToUndefined } from '~/features/clients/client-logic';
import { translate } from '~/lib/i18n';

type ProjectInput = RouterInputs['projects']['create'];
type Project = RouterOutputs['projects']['getById'];

export type ProjectFormValues = {
  name: string;
  clientId: string | null;
  hourlyRate: string;
  fixedPrice: string;
  monthlyBudgetHours: string;
  status: ProjectStatus;
  description: string;
};

export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>;

const NUMBER_RE = /^\d+([.,]\d{1,2})?$/;
const NUMERIC_FIELDS = ['hourlyRate', 'fixedPrice', 'monthlyBudgetHours'] as const;

export function emptyProject(clientId: string | null): ProjectFormValues {
  return { name: '', clientId, hourlyRate: '', fixedPrice: '', monthlyBudgetHours: '', status: 'active', description: '' };
}

export function fromProject(p: Project): ProjectFormValues {
  return {
    name: p.name,
    clientId: p.clientId,
    hourlyRate: p.hourlyRate ?? '',
    fixedPrice: p.fixedPrice ?? '',
    monthlyBudgetHours: p.monthlyBudgetHours ?? '',
    status: (p.status as ProjectStatus | null) ?? 'active',
    description: p.description ?? '',
  };
}

/** Spejler backendens `projectInput`. */
export function validateProject(v: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (v.name.trim().length < 2)
    errors.name = translate('projects.error_name');
  for (const key of NUMERIC_FIELDS) {
    if (v[key].trim() && !NUMBER_RE.test(v[key].trim()))
      errors[key] = translate('projects.error_number');
  }
  return errors;
}

export function toProjectInput(v: ProjectFormValues): ProjectInput {
  const numeric = (s: string) => blankToUndefined(s.replace(',', '.'));
  return {
    name: v.name.trim(),
    clientId: v.clientId,
    hourlyRate: numeric(v.hourlyRate),
    fixedPrice: numeric(v.fixedPrice),
    monthlyBudgetHours: numeric(v.monthlyBudgetHours),
    status: v.status,
    description: blankToUndefined(v.description),
  };
}

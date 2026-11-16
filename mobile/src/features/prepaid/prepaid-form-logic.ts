import type { RouterInputs } from '~/api/app-router';
import { blankToUndefined } from '~/features/clients/client-logic';
import { toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { isISODate, parseDecimal } from './prepaid-logic';

type PrepaidInput = RouterInputs['prepaid']['create'];

export type PrepaidFormValues = {
  name: string;
  clientId: string | null;
  totalHours: string;
  hourlyRate: string;
  expiryDate: string;
  description: string;
  autoDeduct: boolean;
};

export type PrepaidFormErrors = Partial<Record<keyof PrepaidFormValues, string>>;

export function emptyPrepaid(clientId: string | null): PrepaidFormValues {
  return { name: '', clientId, totalHours: '', hourlyRate: '', expiryDate: '', description: '', autoDeduct: true };
}

/** Spejler backendens `prepaidPackageInput`. */
export function validatePrepaid(v: PrepaidFormValues): PrepaidFormErrors {
  const errors: PrepaidFormErrors = {};
  if (v.name.trim().length < 2)
    errors.name = translate('prepaid.error_name');
  if (!v.clientId)
    errors.clientId = translate('prepaid.error_client');
  const hours = parseDecimal(v.totalHours);
  if (hours === null || hours < 0.01)
    errors.totalHours = translate('prepaid.error_hours');
  const rate = parseDecimal(v.hourlyRate);
  if (rate === null || rate < 0)
    errors.hourlyRate = translate('prepaid.error_rate');
  if (v.expiryDate.trim() && !isISODate(v.expiryDate.trim()))
    errors.expiryDate = translate('prepaid.error_date');
  return errors;
}

export function toPrepaidInput(v: PrepaidFormValues, today: Date = new Date()): PrepaidInput {
  return {
    name: v.name.trim(),
    clientId: v.clientId ?? '',
    totalHours: parseDecimal(v.totalHours) ?? 0,
    hourlyRate: parseDecimal(v.hourlyRate) ?? 0,
    purchaseDate: toISODate(today),
    expiryDate: blankToUndefined(v.expiryDate),
    description: blankToUndefined(v.description),
    autoDeduct: v.autoDeduct,
  };
}

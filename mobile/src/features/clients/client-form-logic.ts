import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { translate } from '~/lib/i18n';
import { blankToUndefined, isHexColor } from './client-logic';

type ClientInput = RouterInputs['clients']['create'];
type Client = RouterOutputs['clients']['getById'];

export type ClientFormValues = {
  name: string;
  company: string;
  email: string;
  phone: string;
  cvrNumber: string;
  address: string;
  postalCode: string;
  city: string;
  defaultHourlyRate: string;
  color: string | null;
  notes: string;
};

export type ClientFormErrors = Partial<Record<keyof ClientFormValues, string>>;

export const EMPTY_CLIENT: ClientFormValues = {
  name: '',
  company: '',
  email: '',
  phone: '',
  cvrNumber: '',
  address: '',
  postalCode: '',
  city: '',
  defaultHourlyRate: '',
  color: null,
  notes: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_RE = /^\d+([.,]\d{1,2})?$/;
const WHITESPACE_RE = /\s/g;

export function fromClient(client: Client): ClientFormValues {
  return {
    name: client.name,
    company: client.company ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    cvrNumber: client.cvrNumber ?? '',
    address: client.address ?? '',
    postalCode: client.postalCode ?? '',
    city: client.city ?? '',
    defaultHourlyRate: client.defaultHourlyRate ?? '',
    color: client.color ?? null,
    notes: client.notes ?? '',
  };
}

/** Spejler backendens zod-schema (`clientInput`) — samme grænser, danske tekster. */
export function validateClient(v: ClientFormValues): ClientFormErrors {
  const errors: ClientFormErrors = {};
  if (v.name.trim().length < 2)
    errors.name = translate('clients.error_name');
  if (v.email.trim() && !EMAIL_RE.test(v.email.trim()))
    errors.email = translate('clients.error_email');
  if (v.defaultHourlyRate.trim() && !RATE_RE.test(v.defaultHourlyRate.trim()))
    errors.defaultHourlyRate = translate('clients.error_rate');
  return errors;
}

export function toClientInput(v: ClientFormValues): ClientInput {
  return {
    name: v.name.trim(),
    company: blankToUndefined(v.company),
    email: v.email.trim(),
    phone: blankToUndefined(v.phone),
    cvrNumber: blankToUndefined(v.cvrNumber),
    address: blankToUndefined(v.address),
    postalCode: blankToUndefined(v.postalCode),
    city: blankToUndefined(v.city),
    defaultHourlyRate: blankToUndefined(v.defaultHourlyRate.replace(',', '.')),
    color: isHexColor(v.color) ? v.color : null,
    notes: blankToUndefined(v.notes),
  };
}

/** CVR uden mellemrum; backend kræver 8–10 tegn. */
export function normalizeCvr(value: string): string {
  return value.replace(WHITESPACE_RE, '');
}

export function canLookupCvr(value: string): boolean {
  const cvr = normalizeCvr(value);
  return cvr.length >= 8 && cvr.length <= 10;
}

type CvrCompany = RouterOutputs['integrations']['cvrLookup'];

/** Udfyld tomme felter fra CVR-opslag — overskriv aldrig noget brugeren har tastet. */
export function applyCvr(values: ClientFormValues, company: CvrCompany): Partial<ClientFormValues> {
  if (company === null)
    return {};

  return {
    name: values.name.trim() ? values.name : company.name,
    company: values.company.trim() ? values.company : company.name,
    address: values.address.trim() ? values.address : company.address,
    postalCode: values.postalCode.trim() ? values.postalCode : company.postalCode,
    city: values.city.trim() ? values.city : company.city,
    phone: values.phone.trim() ? values.phone : (company.phoneNumber ?? ''),
    email: values.email.trim() ? values.email : (company.email ?? ''),
  };
}

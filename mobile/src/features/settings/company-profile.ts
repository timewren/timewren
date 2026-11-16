import type { RouterInputs } from '~/api/app-router';

type CompanyInfoInput = RouterInputs['user']['updateCompanyInfo'];
export type CompanyType = NonNullable<CompanyInfoInput['companyType']>;
export type VatPeriod = NonNullable<CompanyInfoInput['vatPeriod']>;

/** Værdierne i web's `user.updateCompanyInfo`-enum. */
export const COMPANY_TYPES: readonly CompanyType[] = ['sole_prop', 'i_s', 'aps', 'as', 'freelance'];
export const VAT_PERIODS: readonly VatPeriod[] = ['monthly', 'quarterly', 'semi_annual', 'none'];

export type CompanyForm = {
  companyType: CompanyType | null;
  vatPeriod: VatPeriod | null;
  /** Rå tekst fra feltet — valideres i `parseFiscalYearEnd`, ikke i renderen. */
  fiscalYearEnd: string;
  hasEmployees: boolean;
};

export type FiscalYearEndResult
  = | { ok: true; value: string }
    | { ok: false; error: 'format' | 'month' | 'day' };

const FISCAL_YEAR_END = /^(\d{1,2})-(\d{1,2})$/;

/**
 * Serveren kræver `MM-DD` (regex `^\d{2}-\d{2}$`), så vi validerer begge dele
 * selv: en måned 13 eller en dag 32 ville give en rå zod-fejl, som
 * `errorMessage` viser som "ugyldig input".
 *
 * Danskere skriver datoen som `31-12`, så når første del ikke kan være en
 * måned og den anden kan, bytter vi dem — ellers ville den altdommeste
 * danske skrivefejl give en uforståelig "ugyldig måned"-fejl.
 */
export function parseFiscalYearEnd(raw: string): FiscalYearEndResult {
  const value = raw.trim();
  if (value === '')
    return { ok: true, value: '' };
  const match = FISCAL_YEAR_END.exec(value);
  if (!match)
    return { ok: false, error: 'format' };
  const first = Number(match[1]);
  const second = Number(match[2]);
  const swapped = first > 12 && second >= 1 && second <= 12;
  const month = swapped ? second : first;
  const day = swapped ? first : second;
  if (month < 1 || month > 12)
    return { ok: false, error: 'month' };
  if (day < 1 || day > 31)
    return { ok: false, error: 'day' };
  return { ok: true, value: `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

/** Ukendte/legacy-værdier fra databasen (varchar) bliver "ikke sat" frem for et kast. */
export function parseCompanyType(raw: string | null | undefined): CompanyType | null {
  return COMPANY_TYPES.includes(raw as CompanyType) ? (raw as CompanyType) : null;
}

export function parseVatPeriod(raw: string | null | undefined): VatPeriod | null {
  return VAT_PERIODS.includes(raw as VatPeriod) ? (raw as VatPeriod) : null;
}

export function formFromProfile(profile: {
  companyType?: string | null;
  vatPeriod?: string | null;
  fiscalYearEnd?: string | null;
  hasEmployees?: boolean | null;
}): CompanyForm {
  return {
    companyType: parseCompanyType(profile.companyType),
    vatPeriod: parseVatPeriod(profile.vatPeriod),
    fiscalYearEnd: profile.fiscalYearEnd ?? '',
    hasEmployees: profile.hasEmployees ?? false,
  };
}

/**
 * `companyType` og `vatPeriod` er påkrævede (men nullable) i inputtet, så de
 * sendes altid med. Tom regnskabsafslutning sendes som `null` — serveren
 * falder så selv tilbage på "31-12" ved fristberegningen.
 */
export function toCompanyInput(form: CompanyForm, fiscalYearEnd: string): CompanyInfoInput {
  return {
    companyType: form.companyType,
    vatPeriod: form.vatPeriod,
    fiscalYearEnd: fiscalYearEnd === '' ? null : fiscalYearEnd,
    hasEmployees: form.hasEmployees,
  };
}

export function isCompanyFormDirty(current: CompanyForm, next: CompanyForm): boolean {
  return current.companyType !== next.companyType
    || current.vatPeriod !== next.vatPeriod
    || current.fiscalYearEnd !== next.fiscalYearEnd
    || current.hasEmployees !== next.hasEmployees;
}

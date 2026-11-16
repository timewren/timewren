import type { CompanyForm } from './company-profile';
import {
  formFromProfile,
  isCompanyFormDirty,
  parseCompanyType,
  parseFiscalYearEnd,
  parseVatPeriod,
  toCompanyInput,
} from './company-profile';

describe('parseFiscalYearEnd', () => {
  it('accepterer tom streng som "ikke sat"', () => {
    expect(parseFiscalYearEnd('   ')).toEqual({ ok: true, value: '' });
  });

  it('normaliserer til to cifre', () => {
    expect(parseFiscalYearEnd('6-30')).toEqual({ ok: true, value: '06-30' });
    expect(parseFiscalYearEnd('12-31')).toEqual({ ok: true, value: '12-31' });
  });

  it('afviser formater der ikke er MM-DD', () => {
    expect(parseFiscalYearEnd('31/12')).toEqual({ ok: false, error: 'format' });
    expect(parseFiscalYearEnd('1231')).toEqual({ ok: false, error: 'format' });
    expect(parseFiscalYearEnd('juni')).toEqual({ ok: false, error: 'format' });
  });

  it('læser 13-01 som 1. januar, fordi 13 ikke kan være en måned', () => {
    expect(parseFiscalYearEnd('13-01')).toEqual({ ok: true, value: '01-13' });
  });

  it('afviser måned og dag uden for grænserne', () => {
    expect(parseFiscalYearEnd('00-01')).toEqual({ ok: false, error: 'month' });
    // Ingen bytte: den anden del er også for stor til at være en måned.
    expect(parseFiscalYearEnd('13-31')).toEqual({ ok: false, error: 'month' });
    expect(parseFiscalYearEnd('12-32')).toEqual({ ok: false, error: 'day' });
    expect(parseFiscalYearEnd('12-00')).toEqual({ ok: false, error: 'day' });
  });

  it('accepterer dansk DD-MM og bytter den til MM-DD', () => {
    expect(parseFiscalYearEnd('31-12')).toEqual({ ok: true, value: '12-31' });
    expect(parseFiscalYearEnd('30-6')).toEqual({ ok: true, value: '06-30' });
  });

  it('bytter kun når den første del umuligt kan være en måned', () => {
    // 12-12 er gyldigt uanset rækkefølgen, så det røres ikke.
    expect(parseFiscalYearEnd('12-12')).toEqual({ ok: true, value: '12-12' });
    // 32-11: dagen kan heller ikke være gyldig, så det er en reel fejl.
    expect(parseFiscalYearEnd('32-11')).toEqual({ ok: false, error: 'day' });
  });
});

describe('parseCompanyType / parseVatPeriod', () => {
  it('kender værdierne fra serverens enum', () => {
    expect(parseCompanyType('aps')).toBe('aps');
    expect(parseVatPeriod('quarterly')).toBe('quarterly');
  });

  it('gør ukendte databasestrenge til "ikke sat" i stedet for at kaste', () => {
    expect(parseCompanyType('kommune')).toBeNull();
    expect(parseCompanyType(undefined)).toBeNull();
    expect(parseVatPeriod('yearly')).toBeNull();
  });
});

describe('formFromProfile', () => {
  it('læser profilen, og null bliver null', () => {
    expect(formFromProfile({ companyType: 'i_s', vatPeriod: 'none', fiscalYearEnd: '06-30', hasEmployees: true }))
      .toEqual({ companyType: 'i_s', vatPeriod: 'none', fiscalYearEnd: '06-30', hasEmployees: true });
    expect(formFromProfile({}))
      .toEqual({ companyType: null, vatPeriod: null, fiscalYearEnd: '', hasEmployees: false });
  });
});

describe('toCompanyInput', () => {
  const base: CompanyForm = { companyType: 'aps', vatPeriod: 'monthly', fiscalYearEnd: '12-31', hasEmployees: false };

  it('sender null for virksomhed uden type, så frister slås fra i stedet for at fejle', () => {
    expect(toCompanyInput({ ...base, companyType: null, vatPeriod: null }, ''))
      .toEqual({ companyType: null, vatPeriod: null, fiscalYearEnd: null, hasEmployees: false });
  });

  it('sender altid companyType og vatPeriod med, også når de er null', () => {
    const input = toCompanyInput(base, '12-31');
    expect(input).toHaveProperty('companyType', 'aps');
    expect(input).toHaveProperty('vatPeriod', 'monthly');
    expect(input).toHaveProperty('fiscalYearEnd', '12-31');
  });
});

describe('isCompanyFormDirty', () => {
  const base: CompanyForm = { companyType: 'aps', vatPeriod: 'monthly', fiscalYearEnd: '12-31', hasEmployees: false };

  it('er ren når intet er ændret', () => {
    expect(isCompanyFormDirty(base, { ...base })).toBe(false);
  });

  it('ser hvert felt', () => {
    expect(isCompanyFormDirty(base, { ...base, companyType: 'as' })).toBe(true);
    expect(isCompanyFormDirty(base, { ...base, vatPeriod: 'none' })).toBe(true);
    expect(isCompanyFormDirty(base, { ...base, fiscalYearEnd: '06-30' })).toBe(true);
    expect(isCompanyFormDirty(base, { ...base, hasEmployees: true })).toBe(true);
  });
});

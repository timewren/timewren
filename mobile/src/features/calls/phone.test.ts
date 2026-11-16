import { findClientsByPhone, matchClientByPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['12345678', '+4512345678'],
    ['12 34 56 78', '+4512345678'],
    ['12-34-56-78', '+4512345678'],
    ['+45 12 34 56 78', '+4512345678'],
    ['+4512345678', '+4512345678'],
    ['0045 12345678', '+4512345678'],
    ['0045-12-34-56-78', '+4512345678'],
    ['4512345678', '+4512345678'],
    ['(+45) 12.34.56.78', '+4512345678'],
    ['tel:+4512345678', '+4512345678'],
    ['  12345678  ', '+4512345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('bevarer udenlandske numre som E.164', () => {
    expect(normalizePhone('+46 70 123 45 67')).toBe('+46701234567');
    expect(normalizePhone('0046 70 123 45 67')).toBe('+46701234567');
  });

  it.each([
    [''],
    ['   '],
    ['1234567'],
    ['123456789'],
    ['+45 1234 567'],
    ['+45 123456789'],
    ['+12345'],
    ['+1234567890123456'],
    ['12a45678'],
    ['hemmeligt nummer'],
  ])('afviser %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('afviser null/undefined', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('klient-match', () => {
  const clients = [
    { id: 'a', name: 'Køleteknik', phone: '+45 12 34 56 78', isArchived: false },
    { id: 'b', name: 'Uden nummer', phone: null, isArchived: false },
    { id: 'c', name: 'Gammel kunde', phone: '87654321', isArchived: true },
    { id: 'd', name: 'Omstilling 1', phone: '70 10 20 30', isArchived: false },
    { id: 'e', name: 'Omstilling 2', phone: '0045 70102030', isArchived: false },
    { id: 'f', name: 'Ugyldigt', phone: 'ring til Jens', isArchived: false },
  ];

  it('finder kunden uanset skrivemåde', () => {
    expect(matchClientByPhone(clients, '12345678')?.id).toBe('a');
    expect(matchClientByPhone(clients, '004512345678')?.id).toBe('a');
  });

  it('ignorerer ukendte og ugyldige numre', () => {
    expect(matchClientByPhone(clients, '11111111')).toBeNull();
    expect(matchClientByPhone(clients, 'ring til Jens')).toBeNull();
    expect(matchClientByPhone(clients, null)).toBeNull();
  });

  it('gætter ikke når flere aktive kunder deler nummer', () => {
    expect(findClientsByPhone(clients, '+4570102030').map(c => c.id)).toEqual(['d', 'e']);
    expect(matchClientByPhone(clients, '+4570102030')).toBeNull();
  });

  it('bruger en arkiveret kunde når den er det eneste match', () => {
    expect(matchClientByPhone(clients, '87 65 43 21')?.id).toBe('c');
  });

  it('foretrækker den aktive kunde frem for en arkiveret med samme nummer', () => {
    const list = [
      { id: 'old', name: 'Gammel', phone: '12345678', isArchived: true },
      { id: 'new', name: 'Ny', phone: '+4512345678', isArchived: false },
    ];
    expect(findClientsByPhone(list, '12345678').map(c => c.id)).toEqual(['new', 'old']);
    expect(matchClientByPhone(list, '12345678')?.id).toBe('new');
  });
});

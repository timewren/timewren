import type { DraftLine, SentSave } from './invoice-lines-logic';
import {
  findProblems,
  lineAmount,
  mayHaveLanded,
  movedLines,
  newLine,
  payloadKey,
  removedEntryIds,
  removeLine,
  sameLines,
  savedLines,
  saveIsLocked,
  tempId,
  totalOf,
  updateLine,
} from './invoice-lines-logic';

function line(over: Partial<DraftLine> = {}): DraftLine {
  return {
    id: 'l1',
    description: 'Timer',
    quantity: '2',
    unitPrice: '500',
    timeEntryId: null,
    ...over,
  };
}

describe('lineAmount', () => {
  it('ganger antal med pris og runder til 2 decimaler', () => {
    expect(lineAmount('2', '500')).toBe('1000.00');
    expect(lineAmount('7,5', '650')).toBe('4875.00');
    expect(lineAmount('1.5', '333.33')).toBe('500.00');
  });

  it('tolererer tomme og ugyldige felter som 0, ligesom web', () => {
    expect(lineAmount('', '500')).toBe('0.00');
    expect(lineAmount('2', '')).toBe('0.00');
    expect(lineAmount('abc', '500')).toBe('0.00');
  });

  it('læser et dansk decimaltegn, som web gør det for lavt', () => {
    // parseFloat('7,5') er 7 — kommaet må ikke gøre beløbet 500 kr. mindre.
    expect(lineAmount('7,5', '650')).toBe('4875.00');
    expect(lineAmount('2,5', '100,50')).toBe('251.25');
  });
});

describe('totalOf', () => {
  it('summerer runderet pr. linje, som serverens sumMoney gør', () => {
    // 0.1+0.2 ville flyde; serveren runderer først summen, vi også.
    const lines = [line({ id: 'a', quantity: '0.1', unitPrice: '1' }), line({ id: 'b', quantity: '0.2', unitPrice: '1' })];
    expect(totalOf(lines)).toBe(0.3);
  });

  it('runderer hver linje før den summeres, så totalen er sum af de viste beløb', () => {
    // 3 × 33,333 er 99,999 — summerer man de udrundede tal bliver det 100.
    const lines = ['a', 'b', 'c'].map(id => line({ id, quantity: '1', unitPrice: '33.333' }));
    expect(savedLines(lines).map(l => l.amount)).toEqual(['33.33', '33.33', '33.33']);
    expect(totalOf(lines)).toBe(99.99);
  });
});

describe('newLine', () => {
  it('lægger en tom linje med temp-id, antal 1 og pris 0', () => {
    const n = newLine();
    expect(n.id).toMatch(/^temp-/);
    expect(n.description).toBe('');
    expect(n.quantity).toBe('1');
    expect(n.unitPrice).toBe('0');
    expect(n.timeEntryId).toBeNull();
  });

  it('giver to linjer forskellige temp-id', () => {
    expect(newLine().id).not.toBe(newLine().id);
  });
});

describe('updateLine', () => {
  it('genberegner beløbet når antal eller pris ændres', () => {
    const lines = [line()];
    expect(updateLine(lines, 'l1', { quantity: '3' })[0].unitPrice).toBe('500');
    expect(savedLines(updateLine(lines, 'l1', { quantity: '3' }))[0].amount).toBe('1500.00');
    expect(savedLines(updateLine(lines, 'l1', { unitPrice: '600' }))[0].amount).toBe('1200.00');
  });

  it('rører ikke beløbet ved en ren tekstændring', () => {
    const lines = [line()];
    const out = updateLine(lines, 'l1', { description: 'Support' });
    expect(out[0].description).toBe('Support');
    expect(savedLines(out)[0].amount).toBe('1000.00');
  });

  it('gør ingen ting ved en ukendt id', () => {
    const lines = [line()];
    expect(updateLine(lines, 'nope', { quantity: '9' })).toEqual(lines);
  });
});

describe('removeLine', () => {
  it('fjerner pr. id og rykker resten sammen uden huller', () => {
    const lines = [line({ id: 'a' }), line({ id: 'b' }), line({ id: 'c' })];
    const out = removeLine(lines, 'b');
    expect(out.map(l => l.id)).toEqual(['a', 'c']);
    expect(savedLines(out).map(l => l.sortOrder)).toEqual([0, 1]);
  });

  it('gør ingen ting ved en ukendt id', () => {
    const lines = [line({ id: 'a' })];
    expect(removeLine(lines, 'b')).toEqual(lines);
  });
});

describe('movedLines', () => {
  const lines = [line({ id: 'a' }), line({ id: 'b' }), line({ id: 'c' })];

  it('flytter en linje op og ned', () => {
    expect(movedLines(lines, 'c', -1).map(l => l.id)).toEqual(['a', 'c', 'b']);
    expect(movedLines(lines, 'a', 1).map(l => l.id)).toEqual(['b', 'a', 'c']);
  });

  it('gør ingenting uden for kanterne — en tabt linje ville frigive tid', () => {
    expect(movedLines(lines, 'a', -1).map(l => l.id)).toEqual(['a', 'b', 'c']);
    expect(movedLines(lines, 'c', 1).map(l => l.id)).toEqual(['a', 'b', 'c']);
    expect(movedLines(lines, 'nope', -1).map(l => l.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('findProblems', () => {
  it('accepterer udfyldte linjer', () => {
    expect(findProblems([line()])).toEqual([]);
  });

  it('tolererer en tom helt ny linje — den er et ubrugt felt', () => {
    expect(findProblems([line(), newLine()])).toEqual([]);
  });

  it('stopper en tom linje der bærer en registrering', () => {
    const p = findProblems([line({ id: 'a', description: '', timeEntryId: 'e1' })]);
    expect(p).toHaveLength(1);
    expect(p[0].id).toBe('a');
  });

  it('stopper en tom linje med et beløb på den', () => {
    expect(findProblems([line({ id: 'a', description: '  ', unitPrice: '500' })])).toHaveLength(1);
  });
});

describe('savedLines', () => {
  it('sender temp-id som undefined, så serveren indsætter den', () => {
    const ny = { ...newLine(), description: 'Rabat', quantity: '1', unitPrice: '100' };
    const out = savedLines([line({ id: 'a' }), ny]);
    expect(out[0].id).toBe('a');
    expect(out[1].id).toBeUndefined();
  });

  it('nummererer sortOrder efter rækkefølgen, ikke efter det gamle felt', () => {
    const out = savedLines([line({ id: 'b' }), line({ id: 'a' })]);
    expect(out.map(l => l.sortOrder)).toEqual([0, 1]);
    expect(out.map(l => l.id)).toEqual(['b', 'a']);
  });

  it('sender beløb, antal, pris og registrering', () => {
    const out = savedLines([line({ timeEntryId: 'e9', quantity: '3', unitPrice: '650' })]);
    expect(out[0]).toMatchObject({ quantity: '3', unitPrice: '650', amount: '1950.00', timeEntryId: 'e9' });
  });

  it('taber det tomme ubrugte felt, så det ikke bliver en tom linje på fakturaen', () => {
    const out = savedLines([line({ id: 'a' }), newLine()]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });

  it('er idempotent på uændrede, gemte linjer — et dobbelttryk indsætter intet', () => {
    const gemt: DraftLine[] = [
      line({ id: 'uuid-1', description: 'Timer', quantity: '2', unitPrice: '500', timeEntryId: 'e1' }),
      line({ id: 'uuid-2', description: 'Support', quantity: '1', unitPrice: '650', timeEntryId: 'e2' }),
    ];
    const foerste = savedLines(gemt);
    const igen = savedLines(gemt);
    expect(igen).toEqual(foerste);
    expect(igen.every(l => l.id !== undefined)).toBe(true);
  });
});

describe('removedEntryIds', () => {
  it('finder de registreringer der frigives, så brugeren kan advares', () => {
    const before = [
      line({ id: 'a', timeEntryId: 'e1' }),
      line({ id: 'b', timeEntryId: 'e2' }),
      line({ id: 'c', timeEntryId: null }),
    ];
    expect(removedEntryIds(before, [before[0], before[2]])).toEqual(['e2']);
  });

  it('tæller ikke en redigeret linje som fjernet', () => {
    const before = [line({ id: 'a', timeEntryId: 'e1' })];
    const after = [{ ...before[0], description: 'Ny tekst' }];
    expect(removedEntryIds(before, after)).toEqual([]);
  });

  it('finder intet når der ikke var linjer før', () => {
    expect(removedEntryIds([], [line()])).toEqual([]);
  });
});

describe('tempId', () => {
  it('gør sig forskel på gemte og nye linjer', () => {
    expect(tempId('temp-123')).toBe(true);
    expect(tempId('7c1a-uuid')).toBe(false);
  });
});

describe('payloadKey', () => {
  it('genkender et gem der er identisk med et allerede lykkedes', () => {
    const gemt: DraftLine[] = [line({ id: 'a' }), { ...newLine(), description: 'Rabat', unitPrice: '100' }];
    expect(payloadKey(gemt)).toBe(payloadKey([...gemt]));
  });

  it('er forskellig, når en værdi ændrer sig', () => {
    expect(payloadKey([line({ id: 'a' })]))
      .not
      .toBe(payloadKey([line({ id: 'a', unitPrice: '600' })]));
  });

  it('er forskellig, når en ny linje kommer til', () => {
    const base = [line({ id: 'a' })];
    const ny = { ...newLine(), description: 'Rabat', unitPrice: '100' };
    expect(payloadKey(base)).not.toBe(payloadKey([...base, ny]));
  });

  it('ignorerer det ubrugte felt, så en tom linje ikke låser knappen', () => {
    expect(payloadKey([line({ id: 'a' })])).toBe(payloadKey([line({ id: 'a' }), newLine()]));
  });
});

describe('sameLines', () => {
  it('ser ens lister som ens, selv om de er to forskellige arrays', () => {
    const a = [line({ id: 'a' }), line({ id: 'b' })];
    const b = [line({ id: 'a' }), line({ id: 'b' })];
    expect(a).not.toBe(b);
    expect(sameLines(a, b)).toBe(true);
  });

  it('ser en ændret værdi, en tilføjet linje og en byttet rækkefølge som ændringer', () => {
    const a = [line({ id: 'a' }), line({ id: 'b' })];
    expect(sameLines(a, [line({ id: 'a' }), line({ id: 'b', unitPrice: '600' })])).toBe(false);
    expect(sameLines(a, [...a, line({ id: 'c' })])).toBe(false);
    expect(sameLines(a, [a[1], a[0]])).toBe(false);
  });

  it('ser to ens felter, kun forskellige i registreringen, som forskellige', () => {
    const a = [line({ id: 'a', timeEntryId: 'e1' })];
    expect(sameLines(a, [line({ id: 'a', timeEntryId: 'e2' })])).toBe(false);
  });
});

describe('mayHaveLanded', () => {
  it('lader et afvist gem sendes igen — serveren rullede transaktionen tilbage', () => {
    // saveLines er én transaction: badRequest("Tidspost ikke fundet") gemmer
    // intet, så låsen må ikke stå tilbage og dræbe knappen.
    expect(mayHaveLanded(400)).toBe(false);
    expect(mayHaveLanded(403)).toBe(false);
    expect(mayHaveLanded(404)).toBe(false);
    expect(mayHaveLanded(401)).toBe(false);
    expect(mayHaveLanded(422)).toBe(false);
  });

  it('beholder låsen når svaret aldrig kom, eller var en 5xx', () => {
    // En 5xx kan komme fra en proxy der svarede efter at transaktionen var
    // commitet, og et tabt svar er det samme. Et genkald ville dobbeltindsætte
    // en temp-linje, så her skal brugeren genindlæse i stedet.
    expect(mayHaveLanded(undefined)).toBe(true);
    expect(mayHaveLanded(500)).toBe(true);
    expect(mayHaveLanded(502)).toBe(true);
    expect(mayHaveLanded(504)).toBe(true);
    // Kun 4xx er et svar fra serveren. Alt andet skal regnes som "kan have
    // gemt", så en ny tRPC-fejlkode aldrig låser knappen ved et fejlkort.
    expect(mayHaveLanded(302)).toBe(true);
  });
});

describe('saveIsLocked', () => {
  const linjer: DraftLine[] = [line({ id: 'a' })];
  const key = payloadKey(linjer);
  const sendt = (over: Partial<SentSave> = {}): SentSave => ({
    key,
    mayHaveLanded: true,
    ...over,
  });

  it('låser, når det samme kan have landet — det ville dobbeltindsætte temp-linjer', () => {
    expect(saveIsLocked(key, sendt())).toBe(true);
  });

  it('giver låsen fri igen efter et afvist gem, så samme krop kan trykkes', () => {
    // Det var den døde knap: sidste sendte krop blev låst FØR kaldet og blev
    // aldrig nulstillet ved en fejl, så ét 4xx låste Gem permanent.
    expect(saveIsLocked(key, sendt({ mayHaveLanded: false }))).toBe(false);
  });

  it('låser ikke et kald vi aldrig har sendt', () => {
    expect(saveIsLocked(key, null)).toBe(false);
  });

  it('låser ikke en nyredigeret liste, fordi den ikke er den sendte krop', () => {
    const redigeret = payloadKey([line({ id: 'a', unitPrice: '600' })]);
    expect(saveIsLocked(redigeret, sendt())).toBe(false);
  });
});

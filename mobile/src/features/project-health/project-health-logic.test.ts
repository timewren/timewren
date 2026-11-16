import type { BudgetAlert, MemberRate, ProjectHealth, RateChange } from './project-health-logic';
import { healthTone } from '~/features/projects/project-logic';
import {
  ALERT_CRITICAL,
  alertLabelKey,
  alertSeverity,
  alertTone,
  attentionCaptionKey,
  attentionCount,
  barFraction,
  budgetUsageLine,
  clientLine,
  hasBudget,
  hasRateHistory,
  memberRate,
  memberRateCount,
  memberRateText,
  rateChangeText,
  rateDirection,
  rateEffectiveDate,
  usageText,
} from './project-health-logic';

function project(over: Partial<ProjectHealth> = {}): ProjectHealth {
  return {
    id: 'p1',
    name: 'Support',
    clientName: 'Acme',
    hoursUsed: 5,
    estimatedBudget: 10,
    budgetPercentage: 50,
    healthStatus: 'green',
    hasFixedPrice: true,
    fixedPrice: 5000,
    hourlyRate: 500,
    ...over,
  };
}

function member(over: Partial<MemberRate> = {}): MemberRate {
  return {
    memberId: 'm1',
    userId: 'u1',
    userName: 'Mads',
    userImage: null,
    role: 'member',
    projectRate: null,
    userDefaultRate: null,
    ...over,
  };
}

function change(over: Partial<RateChange> = {}): RateChange {
  return {
    id: 'r1',
    userId: 'u1',
    organizationId: null,
    clientId: null,
    projectId: 'p1',
    oldRate: '600.00',
    newRate: '750.00',
    rateType: 'project',
    effectiveDate: new Date('2026-09-01T00:00:00.000Z'),
    reason: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  };
}

describe('alertSeverity', () => {
  it('følger web\'s tærskler 80/90/100', () => {
    expect(alertSeverity(79.9)).toBeNull();
    expect(alertSeverity(80)).toBe('warning');
    expect(alertSeverity(89)).toBe('warning');
    expect(alertSeverity(90)).toBe('critical');
    expect(alertSeverity(99)).toBe('critical');
    expect(alertSeverity(100)).toBe('exceeded');
    expect(alertSeverity(140)).toBe('exceeded');
  });

  it('afviser et tal, der ikke er et tal', () => {
    // NaN ville være false-positive i alle sammenligningerne og give 'exceeded'.
    expect(alertSeverity(Number.NaN)).toBeNull();
    expect(alertSeverity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(alertSeverity(undefined)).toBeNull();
    expect(alertSeverity(null)).toBeNull();
  });
});

describe('alertTone', () => {
  it('deler rød mellem critical og exceeded, fordi forskellen står i teksten', () => {
    expect(alertTone('warning')).toBe('warning');
    expect(alertTone('critical')).toBe('danger');
    expect(alertTone('exceeded')).toBe('danger');
    expect(alertTone(null)).toBe('default');
  });

  it('har en oversættelse for hver severity', () => {
    expect(alertLabelKey('warning')).toBe('project_health.alert_warning');
    expect(alertLabelKey('critical')).toBe('project_health.alert_critical');
    expect(alertLabelKey('exceeded')).toBe('project_health.alert_exceeded');
    expect(alertLabelKey(null)).toBeNull();
  });
});

describe('budget', () => {
  it('læser et projekt uden budget som "ingen budget", ikke som 0 %', () => {
    // Serveren sætter budgetPercentage: 0 når der ikke er nogen fastpris.
    const noBudget = project({ estimatedBudget: null, budgetPercentage: 0, hasFixedPrice: false, fixedPrice: null });
    expect(hasBudget(noBudget)).toBe(false);
    expect(usageText(noBudget)).toBe('—');
    expect(barFraction(noBudget)).toBe(0);
  });

  it('afviser et budget på 0 som et budget', () => {
    expect(hasBudget(project({ estimatedBudget: 0 }))).toBe(false);
  });

  it('viser procent kun når der er et budget', () => {
    expect(usageText(project({ budgetPercentage: 92 }))).toBe('92 %');
    expect(usageText(undefined)).toBe('—');
  });

  it('låser bjælken ved 100 % i stedet for at løbe ud af kortet', () => {
    expect(barFraction(project({ budgetPercentage: 250 }))).toBe(1);
    expect(barFraction(project({ budgetPercentage: 50 }))).toBe(0.5);
    expect(barFraction(project({ budgetPercentage: Number.NaN }))).toBe(0);
  });

  it('skriver timerne ud, fordi procent alene ikke siger noget om arbejdet', () => {
    expect(budgetUsageLine(project({ hoursUsed: 4.5, estimatedBudget: 10 }), h => `${h} t`)).toBe('4.5 t af 10 t');
    expect(budgetUsageLine(project({ estimatedBudget: null }), h => `${h} t`)).toBeNull();
  });

  it('springer en tom kundenavn over i stedet for at vise "Intern"', () => {
    expect(clientLine(project())).toBe('Acme');
    expect(clientLine(project({ clientName: '  ' }))).toBeNull();
    expect(clientLine(project({ clientName: '' }))).toBeNull();
  });
});

describe('attentionCount', () => {
  it('tæller kun de røde, uanset rækkefølgen serveren gav', () => {
    const rows = [
      project({ id: 'a', healthStatus: 'green' }),
      project({ id: 'b', healthStatus: 'red' }),
      project({ id: 'c', healthStatus: 'yellow' }),
      project({ id: 'd', healthStatus: 'red' }),
    ];
    expect(attentionCount(rows)).toBe(2);
    expect(attentionCount([])).toBe(0);
    expect(attentionCount(undefined)).toBe(0);
  });

  it('vælger enten-eller-nøgle, så underteksten får et dansk gramatisk tal', () => {
    expect(attentionCaptionKey(1)).toBe('project_health.needs_attention_one');
    expect(attentionCaptionKey(2)).toBe('project_health.needs_attention_other');
  });

  it('har samme tærskel i tonen som i underteksten', () => {
    // Rød = ALERT_CRITICAL, og underteksten indsætter samme tal. Hvis nogen
    // flytter tærsklen, flytter påstanden sig med i stedet for at blive en løgn.
    expect(alertSeverity(ALERT_CRITICAL)).toBe('critical');
    // Samme tone som et rødt projekt får på oversigten.
    expect(alertTone(alertSeverity(ALERT_CRITICAL))).toBe(healthTone('red'));
  });
});

describe('rate history', () => {
  it('skriver "gammel → ny" når begge priser findes', () => {
    expect(rateChangeText(change())).toBe('600 kr. → 750 kr.');
  });

  it('udelader en forrige pris, der ikke findes, i stedet for at finde på en', () => {
    expect(rateChangeText(change({ oldRate: null }))).toBe('750 kr.');
    expect(rateChangeText(change({ oldRate: '' }))).toBe('750 kr.');
  });

  it('viser en tankestreg når serverens værdi ikke er et tal', () => {
    // newRate er NOT NULL i databasen, men et decimal-felt der ikke kan parses
    // må ikke blive "NaN kr." på skærmen.
    expect(rateChangeText(change({ newRate: 'ikke et tal' }))).toBe('—');
  });

  it('markerer stigning, fald og flad pris', () => {
    expect(rateDirection(change())).toBe('up');
    expect(rateDirection(change({ oldRate: '900.00' }))).toBe('down');
    expect(rateDirection(change({ oldRate: '750.00' }))).toBe('flat');
    expect(rateDirection(change({ oldRate: null }))).toBe('up');
    expect(rateDirection(change({ newRate: 'ikke et tal' }))).toBeNull();
  });

  it('formaterer datoen, men lader en ulæselig være uden at kaste', () => {
    // Superjson giver en Invalid Date, hvis serverens tidsstempel ikke kan
    // parses. Rækken skal springes over, ikke vise en tankestegn midt i listen.
    expect(rateEffectiveDate(change())).toBeTruthy();
    expect(rateEffectiveDate(change({ effectiveDate: new Date('ikke en dato') }))).toBeNull();
    expect(rateEffectiveDate(undefined)).toBeNull();
  });

  it('kender forskel på ingen historik og en tom streng', () => {
    expect(hasRateHistory([])).toBe(false);
    expect(hasRateHistory(undefined)).toBe(false);
    expect(hasRateHistory([change()])).toBe(true);
  });
});

describe('member rates', () => {
  it('foretrukker projektets egen sats og markerer en arvet', () => {
    expect(memberRate(member({ projectRate: '800.00', userDefaultRate: '600.00' }))).toEqual({ amount: 800, inherited: false });
    expect(memberRate(member({ projectRate: null, userDefaultRate: '600.00' }))).toEqual({ amount: 600, inherited: true });
  });

  it('har ingen sats at vise uden projektpris og standardpris', () => {
    expect(memberRateText(member())).toBe('—');
    expect(memberRate(member())).toEqual({ amount: null, inherited: true });
  });

  it('tæller kun medlemmer der faktisk har en sats', () => {
    // Serveren svarer med hele orgens medlemmer, også dem uden sats.
    const rows = [
      member({ memberId: 'a', projectRate: '700.00' }),
      member({ memberId: 'b' }),
      member({ memberId: 'c', userDefaultRate: '550.00' }),
    ];
    expect(memberRateCount(rows)).toBe(2);
    expect(memberRateCount(undefined)).toBe(0);
  });
});

describe('budget alerts', () => {
  it('har de felde serveren lover', () => {
    const alert: BudgetAlert = {
      id: 'p1',
      projectName: 'Support',
      clientName: 'Acme',
      hoursUsed: 9,
      budgetHours: 10,
      budgetPercentage: 90,
      fixedPrice: 5000,
      hourlyRate: 500,
      severity: 'critical',
    };
    expect(alertSeverity(alert.budgetPercentage)).toBe(alert.severity);
    expect(alertTone(alert.severity)).toBe('danger');
  });
});

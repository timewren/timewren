import type { SavedEntryLike, ServerTimerState } from './timer-logic';
import {
  buildEntryInput,
  buildStartSyncInput,
  canResumeClaim,
  computeElapsedSeconds,
  EMPTY_TIMER,
  findSavedEntry,
  isClearedOnServer,
  isLocalOnly,
  isSameSession,
  isServerSession,
  isStaleStartRejection,
  isStoppingOnServer,
  mergeServerAndLocal,
  resolveEntryDescription,
  resolveStopMoment,
  selectionNames,
  serverToLocal,
  sessionGuard,
  startLocal,
} from './timer-logic';

const T0 = new Date('2026-09-06T08:00:00.000Z');

describe('computeElapsedSeconds', () => {
  it('er 0 uden startTime', () => {
    expect(computeElapsedSeconds({ startTime: null, baseSeconds: 0 })).toBe(0);
  });

  it('udleder tiden af startTime (aldrig gemt tid)', () => {
    const now = T0.getTime() + 90_500;
    expect(computeElapsedSeconds({ startTime: T0.toISOString(), baseSeconds: 0 }, now)).toBe(90);
  });

  it('lægger serverens baseSeconds til sessionen', () => {
    const now = T0.getTime() + 10_000;
    expect(computeElapsedSeconds({ startTime: T0.toISOString(), baseSeconds: 3600 }, now)).toBe(3610);
  });

  it('klipper en session ved 24 timer og går aldrig under 0', () => {
    const iso = T0.toISOString();
    expect(computeElapsedSeconds({ startTime: iso, baseSeconds: 0 }, T0.getTime() + 3 * 86_400_000)).toBe(86_400);
    expect(computeElapsedSeconds({ startTime: iso, baseSeconds: 5 }, T0.getTime() - 60_000)).toBe(5);
  });

  it('tåler ugyldig startTime', () => {
    expect(computeElapsedSeconds({ startTime: 'ikke-en-dato', baseSeconds: 0 })).toBe(0);
  });
});

describe('buildStartSyncInput', () => {
  it('sender en frisk start med mobilens source som "web"', () => {
    const input = buildStartSyncInput(
      { ...EMPTY_TIMER, projectId: 'p1', clientId: 'c1', description: 'x' },
      T0,
    );
    expect(input).toMatchObject({
      isRunning: true,
      startTime: T0.getTime(),
      sessionStartTime: T0.getTime(),
      elapsedSeconds: 0,
      baseSeconds: 0,
      projectId: 'p1',
      clientId: 'c1',
      taskId: null,
      description: 'x',
      source: 'web',
      isFreshStart: true,
      isAdoption: false,
    });
  });
});

describe('buildEntryInput', () => {
  const running = { ...EMPTY_TIMER, startTime: T0.toISOString(), projectId: 'p1', clientId: 'c1', projectName: 'Website' };

  it('omregner sekunder til timer med to decimaler og sætter datoen fra starten', () => {
    const stoppedAt = new Date(T0.getTime() + 90 * 60_000);
    const entry = buildEntryInput(running, stoppedAt, 'Tidsregistrering');
    expect(entry.hours).toBe(1.5);
    expect(entry.date).toBe('2026-09-06');
    expect(entry.startTime).toBe(T0.toISOString());
    expect(entry.endTime).toBe(stoppedAt.toISOString());
    expect(entry.fromTimer).toBe(true);
    expect(entry.projectId).toBe('p1');
    expect(entry.clientId).toBe('c1');
    expect(entry.taskId).toBeUndefined();
  });

  it('gemmer mindst 0,01 time', () => {
    const entry = buildEntryInput(running, new Date(T0.getTime() + 5_000), 'x');
    expect(entry.hours).toBe(0.01);
  });

  it('falder tilbage til projekt, kunde og til sidst standardtekst', () => {
    expect(resolveEntryDescription({ ...running, description: '  ' }, 'fb')).toBe('Website');
    expect(resolveEntryDescription({ ...running, description: '', projectName: null, clientName: 'Acme' }, 'fb')).toBe('Acme');
    expect(resolveEntryDescription({ ...running, description: '', projectName: null }, 'fb')).toBe('fb');
    expect(resolveEntryDescription({ ...running, description: 'Egen' }, 'fb')).toBe('Egen');
  });
});

const serverBase = {
  isRunning: false,
  startTime: null,
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: null,
  clientId: null,
  description: '',
  project: null,
  client: null,
  version: 4,
  intent: null,
  intentAt: null,
  intentFrom: null,
  prepaidChoice: null,
  sessionId: null as string | null,
};

describe('serverToLocal', () => {
  const base = serverBase;

  it('giver tom timer med serverens version når intet kører', () => {
    expect(serverToLocal(base)).toEqual({ ...EMPTY_TIMER, version: 4 });
  });

  it('adopterer en kørende server-timer inkl. navne', () => {
    const local = serverToLocal({
      ...base,
      isRunning: true,
      startTime: T0.toISOString(),
      baseSeconds: 120,
      projectId: 'p1',
      clientId: 'c1',
      description: 'Web',
      project: { id: 'p1', name: 'Website', clientId: 'c1' },
      client: { id: 'c1', name: 'Acme' },
      version: 9,
      sessionId: 's-1',
    });
    expect(local).toEqual({
      startTime: T0.toISOString(),
      baseSeconds: 120,
      version: 9,
      pendingSync: false,
      sessionId: 's-1',
      projectId: 'p1',
      clientId: 'c1',
      taskId: null,
      description: 'Web',
      projectName: 'Website',
      clientName: 'Acme',
    });
  });

  it('kender et stop+gem fra en anden enhed', () => {
    expect(isClearedOnServer(base)).toBe(true);
    expect(isClearedOnServer({ ...base, version: 0 })).toBe(false);
    expect(isClearedOnServer({ ...base, baseSeconds: 30 })).toBe(false);
  });
});

describe('findSavedEntry', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);
  const local = { ...EMPTY_TIMER, startTime: T0.toISOString(), projectId: 'p1' };

  it('genkender posten fra et tidligere stop med samme start OG slut', () => {
    const entries = [
      { id: 'x', startTime: new Date(T0.getTime() - 7_200_000), endTime: new Date(T0.getTime() - 3_600_000) },
      { id: 'ok', startTime: new Date(T0), endTime: new Date(STOP) },
    ];
    expect(findSavedEntry(entries, local, STOP)?.id).toBe('ok');
  });

  it('lader en post med en anden slut-tid være i fred — den er en anden stop', () => {
    const entries = [{ id: 'næsten', startTime: new Date(T0), endTime: new Date(STOP.getTime() - 1000) }];
    expect(findSavedEntry(entries, local, STOP)).toBeNull();
  });

  it('lader en post med en anden start-tid være i fred', () => {
    const entries = [{ id: 'anden', startTime: new Date(T0.getTime() + 60_000), endTime: new Date(STOP) }];
    expect(findSavedEntry(entries, local, STOP)).toBeNull();
  });

  it('tolererer at serveren svarer med strenge (superjson) og med manglende sluttid', () => {
    expect(findSavedEntry([{ id: 'streng', startTime: T0.toISOString(), endTime: STOP.toISOString() }], local, STOP)?.id).toBe('streng');
    expect(findSavedEntry([{ id: 'åben', startTime: new Date(T0), endTime: null }], local, STOP)).toBeNull();
    const withoutTimes: SavedEntryLike[] = [{ }];
    expect(findSavedEntry(withoutTimes, local, STOP)).toBeNull();
  });

  it('finder intet i en tom liste', () => {
    expect(findSavedEntry([], local, STOP)).toBeNull();
  });

  it('lader en post være når sessionen aldrig har et starttidspunkt', () => {
    const entries = [{ id: 'x', startTime: new Date(T0), endTime: new Date(STOP) }];
    expect(findSavedEntry(entries, { ...EMPTY_TIMER }, STOP)).toBeNull();
  });
});

describe('resolveStopMoment', () => {
  const NOW = new Date('2026-09-06T12:34:56.000Z');
  const local = { ...EMPTY_TIMER, startTime: T0.toISOString() };
  const journal = { stoppedAt: '2026-09-06T11:00:00.000Z', state: local };

  it('bruger det nye stop-øjeblik når der ikke er nogen journal', () => {
    expect(resolveStopMoment(null, local, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('genbruger journalens stop-tidspunkt for DEN SAMME session', () => {
    // Uden dette får et gentaget stop et andet `endTime`, så `findSavedEntry`
    // ikke kan finde den post, første stop gemte — og tiden dobbeltfaktureres.
    expect(resolveStopMoment(journal, local, NOW).toISOString()).toBe('2026-09-06T11:00:00.000Z');
  });

  it('tager et nyt tidspunkt når journalen tilhører en anden session', () => {
    const gammel = { stoppedAt: '2026-09-06T11:00:00.000Z', state: { ...EMPTY_TIMER, startTime: '2026-09-06T09:00:00.000Z' } };
    expect(resolveStopMoment(gammel, local, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('tager et nyt tidspunkt når journalen ikke har en kørende session', () => {
    const tom = { stoppedAt: '2026-09-06T11:00:00.000Z', state: { ...EMPTY_TIMER } };
    expect(resolveStopMoment(tom, local, NOW).toISOString()).toBe(NOW.toISOString());
  });

  it('lader en beskadiget journal give et gyldigt tidspunkt i stedet for NaN', () => {
    const ødelagt = { stoppedAt: 'ikke-en-dato', state: local };
    expect(Number.isFinite(resolveStopMoment(ødelagt, local, NOW).getTime())).toBe(true);
  });
});

describe('afbrudt claim på serveren', () => {
  const local = { ...EMPTY_TIMER, startTime: T0.toISOString() };

  /** Serveren står midt i et stop af DEN session, vi er ved at stoppe. */
  function stopping(overrides: Partial<ServerTimerState> = {}): ServerTimerState {
    return {
      ...serverBase,
      isRunning: true,
      startTime: T0.toISOString(),
      intent: 'stopping',
      intentAt: '2026-09-06T09:00:00.000Z',
      intentFrom: 'web',
      version: 6,
      ...overrides,
    };
  }

  it('genbruger eget claim fra et stop, der aldrig blev bekræftet', () => {
    expect(canResumeClaim(stopping(), local, true)).toBe(true);
  });

  it('rører ALDRIG et claim, der bare ligner vores', () => {
    // `timerSync`s source-enum har kun web/extension, så web-appen sender
    // præcis det samme "web" som mobilen. Et claim med `intentFrom: 'web'`
    // kan derfor ikke bevises at være vores: overtog mobilen web'ens stop,
    // oprettede sin egen post og bekræftede claimet, blev samme time gemt
    // to gange — web'ens egen gemning landede oveni.
    expect(canResumeClaim(stopping(), local, false)).toBe(false);
  });

  it('genbruger ikke et claim på en anden session', () => {
    // `confirmStop` rydder HELE rækken, så et claim på en anden session ville
    // rydde en tid, vi aldrig har gemt.
    expect(canResumeClaim(stopping({ startTime: '2026-09-06T07:00:00.000Z' }), local, true)).toBe(false);
  });

  it('genbruger aldrig et claim fra en anden kilde, heller ikke med bevis', () => {
    expect(canResumeClaim(stopping({ intentFrom: 'extension' }), local, true)).toBe(false);
  });

  it('går ikke i claim-kæden igen, når serveren ikke står i et stop', () => {
    expect(canResumeClaim({ ...serverBase, isRunning: true, startTime: T0.toISOString() }, local, true)).toBe(false);
  });

  it('ser et igangværende stop fra enhver kilde som noget, der ikke må ryddes', () => {
    expect(isStoppingOnServer(stopping())).toBe(true);
    expect(isStoppingOnServer(stopping({ intentFrom: 'extension' }))).toBe(true);
    expect(isStoppingOnServer({ ...serverBase, isRunning: false })).toBe(false);
  });
});

describe('lokal start uden net', () => {
  const idleServer = { ...serverBase };

  it('markerer starten som endnu ikke synket', () => {
    const started = startLocal({ ...EMPTY_TIMER, projectId: 'p1', description: 'Ryggeplads' }, T0);
    expect(started).toMatchObject({ startTime: T0.toISOString(), baseSeconds: 0, pendingSync: true, projectId: 'p1' });
    expect(isLocalOnly(started)).toBe(true);
  });

  it('kender kun en kørende lokal session som lokal', () => {
    expect(isLocalOnly({ startTime: null, pendingSync: true })).toBe(false);
    expect(isLocalOnly({ startTime: T0.toISOString(), pendingSync: false })).toBe(false);
  });

  it('overlever afstemning når serveren intet kører — tiden må ikke tabes', () => {
    const local = startLocal({ ...EMPTY_TIMER, projectId: 'p1' }, T0, 3);
    expect(mergeServerAndLocal(idleServer, local)).toEqual(local);
  });

  it('overlever afstemning selv når en anden enhed kører sin egen session', () => {
    const local = startLocal({ ...EMPTY_TIMER, projectId: 'p1' }, T0, 3);
    const other = { ...serverBase, isRunning: true, startTime: '2026-09-06T07:00:00.000Z', version: 9 };
    expect(mergeServerAndLocal(other, local)).toEqual(local);
  });

  it('afstemmer stadig normalt for en synket session', () => {
    const synced = { ...EMPTY_TIMER, startTime: T0.toISOString(), projectId: 'p1' };
    expect(mergeServerAndLocal(idleServer, synced)).toEqual({ ...EMPTY_TIMER, version: 4 });
  });
});

describe('et stop der ligger i offline-køen', () => {
  // Når timeren stoppes uden net, ligger posten i køen og den LOKALE session
  // ryddes. Serverens række står derimod stadig som "kørende" med præcis den
  // `startTime`, indtil dræningen rydder den. Uden et signal om det ville
  // afstemningen adoptere den døde session, timeren ville genopstå med en
  // større tid, og næste stop ville gemme det samme tidsrum igen.
  const runningServer = {
    ...serverBase,
    isRunning: true,
    startTime: T0.toISOString(),
    version: 7,
  };
  const stoppedLocally = { ...EMPTY_TIMER, version: 7 };

  it('genoplusser ikke en session der allerede er stoppet og ligger i køen', () => {
    expect(mergeServerAndLocal(runningServer, stoppedLocally, [T0.toISOString()])).toEqual(stoppedLocally);
  });

  it('genoplusser heller ikke når køens stop har et andet sessions-øjeblik', () => {
    // Kø-elementet matcher på præcis `startTime`. Et kø-stop for en ANDEN
    // session må ikke holde denne kørende session fast — den er ægte.
    const other = '2026-09-06T06:00:00.000Z';
    expect(mergeServerAndLocal(runningServer, stoppedLocally, [other]).startTime).toBe(T0.toISOString());
  });

  it('adopterer stadig serverens session når intet ligger i køen for den', () => {
    expect(mergeServerAndLocal(runningServer, stoppedLocally, []).startTime).toBe(T0.toISOString());
  });
});

describe('selectionNames', () => {
  it('sætter kunde og projekt sammen i den rækkefølge, timer-kortet viser', () => {
    expect(selectionNames({ clientName: 'Acme Support', projectName: 'Drift' })).toBe('Acme Support · Drift');
  });

  it('tåler kun den ene side — intern tid og kun-kunde skal kunne læses', () => {
    expect(selectionNames({ clientName: 'Acme Support', projectName: null })).toBe('Acme Support');
    expect(selectionNames({ clientName: null, projectName: 'Drift' })).toBe('Drift');
  });

  it('er tom uden valg, så kalderen kan sige "intern tid" i stedet', () => {
    expect(selectionNames({ clientName: null, projectName: null })).toBe('');
  });
});

describe('isSameSession', () => {
  it('samme start (også med afrunding under et sekund) er samme session', () => {
    expect(isSameSession('2026-10-02T08:00:00.000Z', '2026-10-02T08:00:00.000Z')).toBe(true);
    expect(isSameSession(new Date('2026-10-02T08:00:00.400Z'), '2026-10-02T08:00:00.000Z')).toBe(true);
  });

  it('en anden start eller en manglende start er en anden session', () => {
    expect(isSameSession('2026-10-02T09:05:00.000Z', '2026-10-02T08:00:00.000Z')).toBe(false);
    expect(isSameSession(null, '2026-10-02T08:00:00.000Z')).toBe(false);
    expect(isSameSession('2026-10-02T08:00:00.000Z', null)).toBe(false);
  });
});

describe('isStaleStartRejection', () => {
  it('stale_start og not_running + staleStart er endelige afvisninger', () => {
    expect(isStaleStartRejection({ success: false, reason: 'stale_start' })).toBe(true);
    expect(isStaleStartRejection({ success: false, reason: 'not_running', staleStart: true } as never)).toBe(true);
    expect(isStaleStartRejection({ success: false, reason: 'not_running' })).toBe(false);
    expect(isStaleStartRejection({ success: false, reason: 'already_running' })).toBe(false);
    expect(isStaleStartRejection({ success: true })).toBe(false);
  });
});

describe('buildEntryInput — dato', () => {
  it('posten får den danske dag, selv om telefonen står i en anden tidszone', () => {
    const state = { ...EMPTY_TIMER, startTime: '2026-10-02T00:00:00.000Z' };
    expect(buildEntryInput(state, new Date('2026-10-02T01:00:00.000Z'), 'x').date).toBe('2026-10-02');
  });
});

describe('sessions-id (fase 2)', () => {
  const server = { ...serverBase, isRunning: true, startTime: T0.toISOString(), sessionId: 's-1' as string | null };
  const local = { ...EMPTY_TIMER, startTime: T0.toISOString(), sessionId: 's-1' as string | null };

  it('samme start og samme id er samme session', () => {
    expect(isServerSession(server, local)).toBe(true);
  });

  it('samme start men andet id er en anden session', () => {
    expect(isServerSession(server, { ...local, sessionId: 's-2' })).toBe(false);
  });

  it('ukendt id på den ene side afgøres af starttiden (ældre server, gammel lokal tilstand)', () => {
    expect(isServerSession({ ...server, sessionId: null }, local)).toBe(true);
    expect(isServerSession(server, { ...local, sessionId: null })).toBe(true);
    expect(isServerSession(server, { ...local, startTime: '2026-09-06T09:00:00.000Z' })).toBe(false);
  });

  it('sessionGuard sender kun id når det kendes', () => {
    expect(sessionGuard({ version: 3 }, local)).toEqual({ expectedVersion: 3, expectedStartTime: T0.getTime(), sessionId: 's-1' });
    expect(sessionGuard({ version: 3 }, { ...local, sessionId: null })).not.toHaveProperty('sessionId');
  });

  it('buildEntryInput sender timerSessionId kun når sessionen har et id', () => {
    const stoppedAt = new Date(T0.getTime() + 3_600_000);
    expect(buildEntryInput(local, stoppedAt, 'fb')).toMatchObject({ timerSessionId: 's-1' });
    expect(buildEntryInput({ ...local, sessionId: null }, stoppedAt, 'fb')).not.toHaveProperty('timerSessionId');
  });

  it('canResumeClaim kræver samme id, når begge sider kender det', () => {
    const stopping = { ...server, intent: 'stopping', intentFrom: 'web' } as ServerTimerState;
    expect(canResumeClaim(stopping, local, true)).toBe(true);
    expect(canResumeClaim(stopping, { ...local, sessionId: 's-2' }, true)).toBe(false);
  });
});

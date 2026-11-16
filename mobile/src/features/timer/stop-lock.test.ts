import { withStopLock } from './stop-lock';

/** Løsner den igangværende kæde, så testen kan få fat i dens rækkefølge. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('withStopLock', () => {
  it('kører aldrig to stop-kæder samtidig', async () => {
    const events: string[] = [];
    const gate = deferred<void>();
    const first = withStopLock(async () => {
      events.push('første start');
      await gate.promise;
      events.push('første slut');
    });
    const second = withStopLock(async () => {
      events.push('anden start');
    });

    // Den anden må ikke sætte gang, før den første er helt færdig.
    await Promise.resolve();
    expect(events).toEqual(['første start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['første start', 'første slut', 'anden start']);
  });

  it('låser aldrig fast, når kæden kaster', async () => {
    const failed = withStopLock(async () => {
      throw new Error('Network request failed');
    });
    await expect(failed).rejects.toThrow('Network request failed');
    // Et afbrudt stop må ikke låse alle fremtidige stop og recovery.
    await expect(withStopLock(async () => 'ok')).resolves.toBe('ok');
  });

  it('giver hvert genkald sit eget svar', async () => {
    const values = await Promise.all([
      withStopLock(async () => 1),
      withStopLock(async () => 2),
    ]);
    expect(values).toEqual([1, 2]);
  });
});

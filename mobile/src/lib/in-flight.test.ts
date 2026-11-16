import { createInFlight } from './in-flight';

describe('createInFlight', () => {
  it('kører kun det første kald for samme nøgle', async () => {
    const lock = createInFlight<number>();
    const run = jest.fn(async () => 1);
    const first = lock('a', run);
    const second = lock('a', run);
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('giver det andet kald samme svar som det første', async () => {
    const lock = createInFlight<string>();
    const first = lock('a', async () => 'gemt');
    const second = lock('a', async () => 'anden');
    await expect(second).resolves.toBe('gemt');
    await expect(first).resolves.toBe('gemt');
  });

  it('låser kun den nøgle, der trykkes to gange', async () => {
    const lock = createInFlight<number>();
    const run = jest.fn(async () => 1);
    const first = lock('a', run);
    lock('b', run);
    await Promise.all([first]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('frigiver låsen, så næste tryk virker', async () => {
    const lock = createInFlight<number>();
    const run = jest.fn(async () => 1);
    await lock('a', run);
    await lock('a', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('frigiver låsen også når kaldet fejler', async () => {
    const lock = createInFlight<number>();
    const fejl = jest.fn(async () => {
      throw new Error('net');
    });
    await expect(lock('a', fejl)).rejects.toThrow('net');
    const ok = jest.fn(async () => 7);
    await expect(lock('a', ok)).resolves.toBe(7);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('lader to nøgler løbe sideløbs', async () => {
    const lock = createInFlight<string>();
    const slow = jest.fn(async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'a';
    });
    const first = lock('a', slow);
    // Nøgle 'b' må ikke vente på 'a' — ellers låser en langsom start alle
    // duplikeringer i appen, fordi de deler et modul.
    const second = lock('b', async () => 'b');
    await expect(second).resolves.toBe('b');
    await expect(first).resolves.toBe('a');
  });
});

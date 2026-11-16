import type { ServerChange } from './change-server';
import { changeServer } from './change-server';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

function setup(): ServerChange {
  return {
    current: 'https://old.example',
    next: 'https://new.example',
    blocked: jest.fn(() => false),
    probe: jest.fn(async url => url),
    signOut: jest.fn(async () => {}),
    save: jest.fn(async () => {}),
    restart: jest.fn(async () => {}),
  };
}

it('probes before logout, persistence and restart', async () => {
  const deps = setup();
  const order: string[] = [];
  deps.probe = async (url) => {
    order.push('probe');
    return url;
  };
  deps.signOut = async () => {
    order.push('logout');
  };
  deps.save = async () => {
    order.push('save');
  };
  deps.restart = async () => {
    order.push('restart');
  };
  await changeServer(deps);
  expect(order).toEqual(['probe', 'logout', 'save', 'restart']);
});

it('keeps the selection and session on a failed health check', async () => {
  const deps = setup();
  deps.probe = jest.fn().mockRejectedValue(new Error('health'));
  await expect(changeServer(deps)).rejects.toThrow('health');
  expect(deps.save).not.toHaveBeenCalled();
  expect(deps.signOut).not.toHaveBeenCalled();
});

it('refuses switching with unsent work', async () => {
  const deps = setup();
  deps.blocked = () => true;
  await expect(changeServer(deps)).rejects.toThrow('pending');
  expect(deps.probe).not.toHaveBeenCalled();
  expect(deps.save).not.toHaveBeenCalled();
});

it('leaves a same-server choice alone', async () => {
  const deps = setup();
  deps.next = deps.current;
  await changeServer(deps);
  expect(deps.probe).toHaveBeenCalledWith(deps.current);
  expect(deps.signOut).not.toHaveBeenCalled();
  expect(deps.save).not.toHaveBeenCalled();
});

it('checks for pending work again after a slow probe', async () => {
  const deps = setup();
  deps.blocked = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  await expect(changeServer(deps)).rejects.toThrow('pending');
  expect(deps.signOut).not.toHaveBeenCalled();
});

it('never restarts after a persistence failure', async () => {
  const deps = setup();
  deps.save = jest.fn().mockRejectedValue(new Error('keystore'));
  await expect(changeServer(deps)).rejects.toThrow('storage');
  expect(deps.restart).not.toHaveBeenCalled();
});

it('reports a restart failure after saving the verified choice', async () => {
  const deps = setup();
  deps.restart = jest.fn().mockRejectedValue(new Error('reload'));
  await expect(changeServer(deps)).rejects.toThrow('restart');
  expect(deps.save).toHaveBeenCalledWith('https://new.example');
});

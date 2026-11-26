import { onlineManager } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import * as React from 'react';
import { AppState } from 'react-native';
import { APIProvider } from './provider';

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(),
}));
jest.mock('@dev-plugins/react-query', () => ({ useReactQueryDevTools: jest.fn() }));
jest.mock('~/lib/monitoring', () => ({ captureError: jest.fn() }));
jest.mock('./trpc', () => ({
  createReactTRPCClient: () => ({}),
  trpc: { Provider: ({ children }: { children: React.ReactNode }) => children },
}));

it('revalidates after a transport outage without a network or focus event', async () => {
  jest.useFakeTimers();
  const previousState = AppState.currentState;
  AppState.currentState = 'active';
  try {
    jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ isConnected: true });
    const revalidate = jest.fn()
      .mockImplementationOnce(async () => {
        await Promise.resolve();
        onlineManager.setOnline(false);
      })
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const view = render(<APIProvider onNetworkReady={revalidate}>{null}</APIProvider>);
    await waitFor(() => expect(onlineManager.isOnline()).toBe(false));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(revalidate).toHaveBeenLastCalledWith(true);
    expect(onlineManager.isOnline()).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(revalidate).toHaveBeenCalledTimes(3);
    expect(onlineManager.isOnline()).toBe(true);
    view.unmount();
  }
  finally {
    AppState.currentState = previousState;
    jest.useRealTimers();
    onlineManager.setOnline(true);
  }
});

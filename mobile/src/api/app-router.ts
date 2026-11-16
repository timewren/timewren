import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../src/lib/trpc/routers';

export type { AppRouter };
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type Probe = RouterOutputs['time']['list'];
export type Probe2 = RouterOutputs['enterprise']['getVacationBalance'];

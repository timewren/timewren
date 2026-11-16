import type { RouterOutputs } from '~/api/app-router';

type Package = RouterOutputs['prepaid']['list'][number];

export const LOW_FRACTION = 0.2;
const MAX_CARDS = 3;

export function packageFraction(pkg: Pick<Package, 'totalHours' | 'remainingHours'>): number {
  const total = Number.parseFloat(String(pkg.totalHours ?? '0'));
  const remaining = Number.parseFloat(String(pkg.remainingHours ?? '0'));
  if (!Number.isFinite(total) || total <= 0)
    return 0;
  return Math.max(0, Math.min(1, remaining / total));
}

/** De op til 3 aktive klippekort med lavest saldo — advarsel under 20 %. */
export function pickLowest(packages: Package[]): Package[] {
  return [...packages]
    .sort((a, b) => packageFraction(a) - packageFraction(b))
    .slice(0, MAX_CARDS);
}

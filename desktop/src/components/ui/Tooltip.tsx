import { cloneElement, type ReactElement, useState } from "react";

type TriggerProps = {
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: { key: string }) => void;
};

/**
 * Etiket der dukker op, når handlingen kun har et ikon.
 *
 * Knap har allerede sit eget `aria-label`, så skærmlæseren har altid navnet.
 * Tooltip'en er til den, der **ser** ikonet og ikke ved hvad det er: en række
 * af otte ens ikoner i en 56 px bred sidebjælke er ikke læsbar uden den. Den
 * vises ved hover **og** ved fokus, så den virker for tastatur, og lukkes med
 * Escape, så den ikke kan hænge oveni det brugeren nu laver.
 *
 * `barn` skal være **ét** element — helst en knap. Handlerne lægges på barnet
 * og ikke på indpakningen, fordi en `<span>` med muse-handlere hverken kan
 * få fokus eller tastatur, og skærmlæseren så ville miste et navn den ikke
 * kan nå. `children` ville også gøre det umuligt at teste om `Escape` lukker
 * noget, uden at teste-laget skulle ramme ind i en `span`.
 */
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<TriggerProps>;
}) {
  const [synlig, setSynlig] = useState(false);
  const barn = children.props;

  const udvidet = cloneElement(children, {
    // Barnets egne handlers kaldes først: herregementet skal ikke slå dem ihjel.
    onMouseEnter: () => {
      barn.onMouseEnter?.();
      setSynlig(true);
    },
    onMouseLeave: () => {
      barn.onMouseLeave?.();
      setSynlig(false);
    },
    onFocus: () => {
      barn.onFocus?.();
      setSynlig(true);
    },
    onBlur: () => {
      barn.onBlur?.();
      setSynlig(false);
    },
    onKeyDown: (e: { key: string }) => {
      barn.onKeyDown?.(e);
      if (e.key === "Escape") setSynlig(false);
    },
  });

  return (
    <span className="relative block w-full">
      {udvidet}
      {synlig && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1 text-xs whitespace-nowrap text-(--color-text) shadow-sm"
        >
          {label}
        </span>
      )}
    </span>
  );
}

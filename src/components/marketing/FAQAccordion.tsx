import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type FAQItem = {
  question: string;
  answer: ReactNode;
};

export function FAQAccordion({
  items,
  title,
  subtitle,
}: {
  items: FAQItem[];
  title?: string;
  subtitle?: string;
}) {
  return (
    <div>
      {title && (
        <div className="mb-8">
          <h2 className="text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.03em] text-tt-blaek sm:text-[44px]">
            {title}
          </h2>
          {subtitle && <p className="mt-3 text-tt-graa">{subtitle}</p>}
        </div>
      )}

      <div className="divide-y divide-tt-streg border-y border-tt-streg">
        {items.map((item) => (
          <details key={item.question} className="group py-5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 font-semibold text-tt-blaek [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronRight
                className="h-5 w-5 shrink-0 text-tt-graa transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 max-w-3xl text-[17px] leading-relaxed text-tt-graa">
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

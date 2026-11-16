import Link from "next/link";
import type { ReactNode } from "react";

type FeatureLink = { href: string; label: string };

export function FeatureCard({
  icon,
  title,
  description,
  links,
  variant = "default",
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  links?: FeatureLink[];
  variant?: "default" | "compact" | "horizontal";
}) {
  if (variant === "horizontal") {
    return (
      <div className="rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm transition hover:shadow-md">
        <div className="flex items-start gap-4">
          {icon && <div className="mt-1 text-brand-600">{icon}</div>}
          <div>
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-slate-600">{description}</p>
            {links && links.length > 0 && (
              <p className="mt-4 text-sm text-slate-600">
                Se også:{" "}
                {links.map((l, idx) => (
                  <span key={l.href}>
                    <Link
                      className="underline hover:text-brand-600"
                      href={l.href}
                    >
                      {l.label}
                    </Link>
                    {idx < links.length - 1 ? " / " : null}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-slate-200/60 bg-white shadow-sm transition hover:shadow-md ${variant === "compact" ? "p-6" : "p-8"}`}
    >
      {icon && <div className="mb-4 text-brand-600">{icon}</div>}
      <h3
        className={`font-semibold text-slate-900 ${variant === "compact" ? "text-lg" : "text-xl"}`}
      >
        {title}
      </h3>
      <p
        className={`mt-2 text-slate-600 ${variant === "compact" ? "text-sm" : ""}`}
      >
        {description}
      </p>
      {links && links.length > 0 && (
        <p className="mt-4 text-sm text-slate-600">
          Se også:{" "}
          {links.map((l, idx) => (
            <span key={l.href}>
              <Link className="underline hover:text-brand-600" href={l.href}>
                {l.label}
              </Link>
              {idx < links.length - 1 ? " / " : null}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

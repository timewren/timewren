import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  align = "center",
  dark = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "center" | "left";
  dark?: boolean;
}) {
  return (
    <div className={`mb-12 ${align === "center" ? "text-center" : ""}`}>
      <h2
        className={`text-2xl font-bold sm:text-3xl lg:text-4xl ${dark ? "text-white" : "text-slate-900"}`}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className={`mx-auto mt-4 max-w-2xl text-lg ${dark ? "text-brand-100" : "text-slate-600"} ${align === "center" ? "" : "mx-0"}`}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

type BentoItem = {
  title: string;
  description: string;
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "glass" | "highlight";
  href?: string;
};

function BentoCard({ item }: { item: BentoItem }) {
  const sizeClass =
    item.size === "lg"
      ? "md:col-span-2 md:row-span-2"
      : item.size === "md"
        ? "md:col-span-2"
        : "";

  const variantClass =
    item.variant === "glass"
      ? "border-white/20 bg-white/60 backdrop-blur-sm"
      : item.variant === "highlight"
        ? "border-brand-200/60 bg-brand-50"
        : "border-slate-200/60 bg-white";

  const content = (
    <>
      {item.icon && <div className="mb-4 text-brand-600">{item.icon}</div>}
      <h3
        className={`font-semibold text-slate-900 ${item.size === "lg" ? "text-xl" : "text-lg"}`}
      >
        {item.title}
      </h3>
      <p
        className={`mt-2 text-slate-600 ${item.size === "sm" ? "text-sm" : ""}`}
      >
        {item.description}
      </p>
    </>
  );

  const className = `rounded-2xl border p-6 shadow-sm transition hover:shadow-md ${sizeClass} ${variantClass}`;

  if (item.href) {
    return (
      <Link
        href={item.href}
        className={`block hover:-translate-y-0.5 ${className}`}
      >
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

export function BentoGrid({ items }: { items: BentoItem[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {items.map((item) => (
        <BentoCard key={item.title} item={item} />
      ))}
    </div>
  );
}

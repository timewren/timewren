import Link from "next/link";

type RelatedLink = {
  href: string;
  title: string;
  description: string;
};

/** Relaterede sider som en liste med streger, ikke et gitter af kort. */
export function RelatedLinks({
  title = "Relaterede sider",
  subtitle,
  links,
}: {
  title?: string;
  subtitle?: string;
  links: RelatedLink[];
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:gap-16 [&>*]:min-w-0">
      <div>
        <h2 className="text-2xl font-bold tracking-[-0.02em] text-tt-blaek sm:text-[32px]">
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-tt-graa">{subtitle}</p>}
      </div>
      <ul className="border-t border-tt-streg">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="group grid gap-1 border-b border-tt-streg py-4 sm:grid-cols-[220px_1fr] sm:gap-6"
            >
              <span className="font-semibold text-tt-blaek group-hover:text-tt-gran">
                {link.title}
              </span>
              <span className="text-tt-graa">{link.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

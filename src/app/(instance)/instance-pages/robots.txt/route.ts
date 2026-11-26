import robots from "@/app/robots";

export const dynamic = "force-dynamic";

export function GET() {
  const { rules, sitemap } = robots();
  const sections = [rules]
    .flat()
    .map(({ userAgent, allow, disallow }) =>
      [
        ...[userAgent].flat().map((value) => `User-agent: ${value}`),
        ...[allow ?? []].flat().map((value) => `Allow: ${value}`),
        ...[disallow ?? []].flat().map((value) => `Disallow: ${value}`),
      ].join("\n"),
    );
  sections.push(...[sitemap ?? []].flat().map((url) => `Sitemap: ${url}`));
  return new Response(`${sections.join("\n\n")}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

import { notFound } from "next/navigation";
import {
  ArbejdsdageMonthPage,
  arbejdsdageMonthMetadata,
} from "@/components/marketing/ArbejdsdageMonthPage";
import { MONTH_SLUGS, monthFromSlug } from "@/lib/marketing/arbejdsdage-seo";

const YEAR = 2027;

type Params = Promise<{ maaned: string }>;

export const dynamicParams = false;

export function generateStaticParams() {
  return MONTH_SLUGS.map((maaned) => ({ maaned }));
}

export async function generateMetadata({ params }: { params: Params }) {
  const month = monthFromSlug((await params).maaned);
  if (month === null) notFound();
  return arbejdsdageMonthMetadata(YEAR, month);
}

export default async function ArbejdsdageMonthRoute({
  params,
}: {
  params: Params;
}) {
  const month = monthFromSlug((await params).maaned);
  if (month === null) notFound();
  return <ArbejdsdageMonthPage year={YEAR} month={month} />;
}

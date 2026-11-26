import {
  ArbejdstimerYearPage,
  arbejdstimerYearMetadata,
} from "@/components/marketing/ArbejdstimerYearPage";

export const metadata = arbejdstimerYearMetadata(2026);

export default function ArbejdstimerYearRoute() {
  return <ArbejdstimerYearPage year={2026} />;
}

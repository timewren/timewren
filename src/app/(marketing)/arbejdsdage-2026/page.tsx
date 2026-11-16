import {
  ArbejdsdagePage,
  arbejdsdageMetadata,
} from "@/components/marketing/ArbejdsdagePage";

export const metadata = arbejdsdageMetadata(2026);

export default function Arbejdsdage2026Page() {
  return <ArbejdsdagePage year={2026} otherYears={[2027]} />;
}

import {
  ArbejdsdagePage,
  arbejdsdageMetadata,
} from "@/components/marketing/ArbejdsdagePage";

export const metadata = arbejdsdageMetadata(2027);

export default function Arbejdsdage2027Page() {
  return <ArbejdsdagePage year={2027} otherYears={[2026]} />;
}

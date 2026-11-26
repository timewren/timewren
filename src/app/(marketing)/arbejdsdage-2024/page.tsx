import {
  ArbejdsdagePage,
  arbejdsdageMetadata,
} from "@/components/marketing/ArbejdsdagePage";

export const metadata = arbejdsdageMetadata(2024);

export default function ArbejdsdageYearPage() {
  return <ArbejdsdagePage year={2024} />;
}

import {
  SeoCalculatorPage,
  seoCalculatorMetadata,
} from "@/components/marketing/SeoCalculatorPage";
import { seoTools } from "@/lib/marketing/seo-tools";

const tool = seoTools.holiday;
export const metadata = seoCalculatorMetadata(tool);

export default function Page() {
  return <SeoCalculatorPage tool={tool} />;
}

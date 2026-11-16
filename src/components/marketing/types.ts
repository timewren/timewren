export interface CompetitorData {
  name: string;
  logo?: string;
  description: string;
  pricing: Array<{ plan: string; price: number; period: string }>;
  targetAudience: string;
  weaknesses: string[];
}

export interface QuickComparisonRow {
  feature: string;
  us: string | boolean;
  them: string | boolean;
}

export interface FeatureCategory {
  category: string;
  items: Array<{
    name: string;
    us: string | boolean;
    them: string | boolean;
  }>;
}

export interface PricingComparison {
  scenario: string;
  usPrice: string;
  themPrice: string;
  savings: string;
}

export interface MigrationStep {
  title: string;
  description: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface CompetitorComparisonPageProps {
  competitor: CompetitorData;
  hero: {
    title: string;
    subtitle: string;
  };
  quickComparison: QuickComparisonRow[];
  features: FeatureCategory[];
  pricingComparison: PricingComparison;
  migrationSteps: MigrationStep[];
  faq: FAQItem[];
  ctaText?: string;
  /** Hvornår og ud fra hvad sammenligningen er lavet, vist under hero. */
  comparedAt?: string;
  /** Overskrift på prisafsnittet. Standard: "Spar penge med TimeTrack". */
  pricingTitle?: string;
  relatedComparisons?: Array<{ name: string; href: string }>;
}

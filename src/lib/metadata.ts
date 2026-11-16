import type { Metadata } from "next";
import {
  BUSINESS_BASE_PRICE_MONTHLY,
  getMarketingUrl,
  PRIVAT_PRICE_MONTHLY,
  planNameForTier,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_BASE_PRICE_MONTHLY,
} from "./config";

interface PageMetadata {
  title: string;
  description: string;
  keywords?: string[];
  canonical?: string;
  ogImage?: string;
  noindex?: boolean;
}

// Canonical/SEO base is the marketing host (timetrack.dk), independent of the
// authenticated app host (app.timetrack.dk).
const baseUrl = getMarketingUrl();

export function generateMetadata({
  title,
  description,
  keywords = [],
  canonical,
  ogImage = `${baseUrl}/opengraph-image`,
  noindex = false,
}: PageMetadata): Metadata {
  const fullTitle = title.includes("TimeTrack")
    ? title
    : `${title} | TimeTrack`;
  const url = canonical ? `${baseUrl}${canonical}` : baseUrl;

  return {
    title: fullTitle,
    description,
    keywords: [
      "effihub alternativ",
      "klippekort system",
      "tidsregistrering",
      "billy integration",
      "dinero integration",
      "freelance fakturering",
      "timetracking software",
      "dansk freelancer værktøj",
      ...keywords,
    ],
    authors: [{ name: "TimeTrack" }],
    creator: "TimeTrack",
    publisher: "TimeTrack",
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      locale: "da_DK",
      url,
      title: fullTitle,
      description,
      siteName: "TimeTrack",
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
    robots: {
      index: !noindex,
      follow: !noindex,
      googleBot: {
        index: !noindex,
        follow: !noindex,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

// Structured data helpers
export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TimeTrack",
    url: baseUrl,
    logo: `${baseUrl}/icon.svg`,
    description:
      "Tidsregistrering til selvstændige og små bureauer, med klippekort og fakturagrundlag til Billy, Dinero og e-conomic.",
    address: {
      "@type": "PostalAddress",
      addressCountry: "DK",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      availableLanguage: ["Danish", "English"],
    },
  };
}

export function softwareApplicationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TimeTrack",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    // Priserne trækkes fra config så structured data aldrig kan afvige fra
    // pricing-siden (tidligere stod her opdigtede planer med forkerte priser).
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "0",
      highPrice: String(BUSINESS_BASE_PRICE_MONTHLY),
      priceCurrency: "DKK",
      priceSpecification: [
        {
          "@type": "UnitPriceSpecification",
          price: "0",
          priceCurrency: "DKK",
          name: planNameForTier("free"),
        },
        {
          "@type": "UnitPriceSpecification",
          price: String(PRIVAT_PRICE_MONTHLY),
          priceCurrency: "DKK",
          name: planNameForTier("privat"),
        },
        {
          "@type": "UnitPriceSpecification",
          price: String(SUBSCRIPTION_PRICE_MONTHLY),
          priceCurrency: "DKK",
          name: planNameForTier("solo"),
        },
        {
          "@type": "UnitPriceSpecification",
          price: String(TEAM_BASE_PRICE_MONTHLY),
          priceCurrency: "DKK",
          name: planNameForTier("team"),
        },
        {
          "@type": "UnitPriceSpecification",
          price: String(BUSINESS_BASE_PRICE_MONTHLY),
          priceCurrency: "DKK",
          name: planNameForTier("business"),
        },
      ],
    },
    description:
      "Tidsregistrering til selvstændige og små bureauer, med klippekort og fakturagrundlag til Billy, Dinero og e-conomic.",
  };
}

export function faqPageSchema(faqs: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

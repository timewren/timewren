import { ArrowRight, Calendar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { BLOG_POSTS, formatBlogDate } from "@/lib/marketing/blog-posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Artikler om timeregistrering, freelance-fakturering, klippekort og produktivitet. Tips og guides fra TimeTrack.",
  openGraph: {
    title: "Blog",
    description:
      "Artikler om timeregistrering, freelance-fakturering, klippekort og produktivitet.",
  },
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />
      <MarketingHero
        title="Blog"
        subtitle="Tips, guides og indsigter om timeregistrering, fakturering og freelance-produktivitet."
      />

      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="space-y-8">
            {BLOG_POSTS.map((post) => (
              <article
                key={post.slug}
                className="group rounded-2xl border border-slate-200 p-6 transition-shadow hover:shadow-lg sm:p-8"
              >
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span className="rounded-full bg-brand-50 px-3 py-0.5 text-xs font-medium text-brand-700">
                    {post.category}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatBlogDate(post.date)}
                  </span>
                  <span>{post.readTime}</span>
                </div>

                <Link href={`/blog/${post.slug}`}>
                  <h2 className="mt-3 text-xl font-bold text-slate-900 group-hover:text-brand-600 sm:text-2xl">
                    {post.title}
                  </h2>
                </Link>

                <p className="mt-2 text-slate-600">{post.excerpt}</p>

                <Link
                  href={`/blog/${post.slug}`}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Læs artiklen
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

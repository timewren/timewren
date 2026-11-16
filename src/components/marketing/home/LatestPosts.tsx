import Link from "next/link";
import { mk } from "@/components/marketing/mk";
import { BLOG_POSTS, formatBlogDate } from "@/lib/marketing/blog-posts";

/**
 * Let strimmel med de nyeste blogindlæg (issue #877): ingen ny sektion med
 * billeder, kun tre linjer, så forsiden ikke tynges ned. Deler data med
 * /blog via src/lib/marketing/blog-posts.ts.
 */
export function LatestPosts() {
  const latest = BLOG_POSTS.slice(0, 3);
  return (
    <p className={`${mk.fine} mt-10`}>
      Seneste fra mig:{" "}
      {latest.map((post, i) => (
        <span key={post.slug}>
          <Link href={`/blog/${post.slug}`} className={mk.link}>
            {post.title}
          </Link>{" "}
          ({formatBlogDate(post.date)}){i < latest.length - 1 ? ", " : ""}
        </span>
      ))}
    </p>
  );
}

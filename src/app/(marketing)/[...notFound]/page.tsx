import { notFound } from "next/navigation";

// Multiple root layouts have no shared not-found document. Route unmatched
// URLs through the marketing boundary to retain the branded 404 and its CSS.
export default function UnmatchedRoute() {
  notFound();
}

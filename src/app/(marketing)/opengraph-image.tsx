// Route segment config must be a literal here; the image itself is shared with
// /opengraph-image (src/app/opengraph-image/route.ts), which self-host builds
// serve without the marketing group.
export const runtime = "edge";
export { alt, contentType, default, size } from "@/lib/og/site-og-image";

import Image from "@/lib/og/site-og-image";

export const runtime = "edge";

// The file convention adds a suffix inside a route group. Serve the stable
// URL used by the document metadata and the self-host marketing guard too.
export const GET = Image;

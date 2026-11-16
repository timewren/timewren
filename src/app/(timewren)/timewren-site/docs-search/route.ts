import { createFromSource } from "fumadocs-core/search/server";
import { docsSource } from "@/lib/timewren-docs/source";

// Fumadocs' indbyggede søgning (ingen ekstern tjeneste). Nås kun via
// middleware-rewrite fra /docs-search på TimeWrens marketinghost; ?locale=
// vælger sproget.
export const { GET } = createFromSource(docsSource);

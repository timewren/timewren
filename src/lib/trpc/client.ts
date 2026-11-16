import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getAppUrl } from "@/lib/config";
import type { AppRouter } from "./routers";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getAppUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});

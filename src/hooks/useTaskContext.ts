import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useTaskPreferencesStore } from "@/stores/taskPreferencesStore";

interface TaskContext {
  projectId: string | null;
  clientId: string | null;
}

/**
 * Resolves task context (project/client) with priority:
 * 1. Explicit props (highest)
 * 2. URL query params (?projectId=...&clientId=...)
 * 3. Current page context (URL matches /projects/[id])
 * 4. Preferences store (lastProjectId/lastClientId)
 */
export function useTaskContext(props?: {
  projectId?: string | null;
  clientId?: string | null;
}): TaskContext {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { lastProjectId, lastClientId } = useTaskPreferencesStore();

  return useMemo(() => {
    // 1. Explicit props
    if (props?.projectId || props?.clientId) {
      return {
        projectId: props.projectId || null,
        clientId: props.clientId || null,
      };
    }

    // 2. URL query params
    const urlProjectId = searchParams.get("projectId");
    const urlClientId = searchParams.get("clientId");
    if (urlProjectId || urlClientId) {
      return {
        projectId: urlProjectId,
        clientId: urlClientId,
      };
    }

    // 3. Current page context
    const projectMatch = pathname.match(/\/projects\/([a-f0-9-]+)/);
    if (projectMatch) {
      return {
        projectId: projectMatch[1],
        clientId: null,
      };
    }

    const clientMatch = pathname.match(/\/clients\/([a-f0-9-]+)/);
    if (clientMatch) {
      return {
        projectId: null,
        clientId: clientMatch[1],
      };
    }

    // 4. Preferences store
    return {
      projectId: lastProjectId,
      clientId: lastClientId,
    };
  }, [
    props?.projectId,
    props?.clientId,
    searchParams,
    pathname,
    lastProjectId,
    lastClientId,
  ]);
}

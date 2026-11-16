import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc-provider";

interface ClientProjectSelectionResult {
  autoSelectedProjectId: string | null;
  projects: {
    id: string;
    name: string;
    clientId: string | null;
    description: string | null;
  }[];
  isLoading: boolean;
}

export function useClientProjectSelection(
  clientId: string | null | undefined,
): ClientProjectSelectionResult {
  const { data: projects, isLoading } = trpc.projects.getByClient.useQuery(
    clientId ? { clientId } : skipToken,
  );

  const activeProjects = projects?.filter((p) => p.status === "active") ?? [];

  if (!clientId || isLoading) {
    return { autoSelectedProjectId: null, projects: [], isLoading };
  }

  if (activeProjects.length === 1) {
    return {
      autoSelectedProjectId: activeProjects[0].id,
      projects: activeProjects,
      isLoading: false,
    };
  }

  return {
    autoSelectedProjectId: null,
    projects: activeProjects,
    isLoading: false,
  };
}

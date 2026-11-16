import {
  AppWindow,
  Folder,
  GitBranch,
  Globe,
  type LucideIcon,
  Tag,
} from "lucide-react";
import type { MatcherKind } from "@/lib/types";

/** Icon per signal kind — shared by the wizard and the matcher list. */
export const KIND_ICON: Record<MatcherKind, LucideIcon> = {
  git_repo: GitBranch,
  path: Folder,
  domain: Globe,
  keyword: Tag,
  app: AppWindow,
};

/** i18n key per signal kind. */
export const KIND_LABEL_KEY: Record<MatcherKind, string> = {
  git_repo: "identity.kindGitRepo",
  path: "identity.kindPath",
  domain: "identity.kindDomain",
  keyword: "identity.kindKeyword",
  app: "identity.kindApp",
};

/**
 * Shortens a long value in the middle, so both the root and the leaf stay
 * readable — the leaf of a path is what identifies the project, the root is
 * what tells the user which machine/area it lives in.
 */
export function truncateMiddle(value: string, max = 52): string {
  if (value.length <= max) return value;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

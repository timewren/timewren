import type { Activity } from "./types";

/** Default max gap (seconds) between adjacent activities that still merge. */
export const DEFAULT_MAX_GAP_SECONDS = 180;

/**
 * Default max duration (seconds) of a foreign interruption that may be
 * absorbed into the surrounding session. Kept small on purpose: only a brief
 * detour (a quick lookup) folds into the work around it — anything longer
 * stays its own block.
 */
export const DEFAULT_MAX_INTERRUPTION_SECONDS = 60;

export interface MergeOptions {
  maxGapSeconds?: number;
  /**
   * A foreign segment shorter than this, flanked on both sides by the SAME
   * merge key, is absorbed into that session. Separate from `maxGapSeconds`.
   */
  maxInterruptionSeconds?: number;
}

export interface ActivityBlock {
  /** Merge key: project (if set) or app, plus category and confirmed-status. */
  key: string;
  projectId: string | null;
  appName: string;
  category: string | null;
  isConfirmed: boolean;
  startedAt: string;
  endedAt: string;
  /** Sum of member durations — gaps between members do NOT count as work. */
  totalDuration: number;
  activityIds: number[];
  activities: Activity[];
  /** window_title of the member with the largest duration. */
  dominantTitle: string | null;
}

function mergeKey(activity: Activity): string {
  // Without a project, git_repo/context_path are part of the identity —
  // mirroring the tracker's same_segment and the AI GroupKey — so two repos
  // or project folders sharing one app are never confirmed as a single
  // block, which would attribute one client's time to another's project.
  // With a project assigned, repo/context may differ freely: confirming
  // gives every member the project it already has.
  const subject = activity.project_id
    ? `p:${activity.project_id}`
    : `a:${activity.app_name}|r:${activity.git_repo ?? ""}|x:${activity.context_path ?? ""}`;
  return `${subject}|c:${activity.category ?? ""}|f:${activity.is_confirmed ? 1 : 0}`;
}

function toBlock(activity: Activity): ActivityBlock {
  return {
    key: mergeKey(activity),
    projectId: activity.project_id,
    appName: activity.app_name,
    category: activity.category,
    isConfirmed: activity.is_confirmed,
    startedAt: activity.started_at,
    endedAt: activity.ended_at,
    totalDuration: activity.duration,
    activityIds: [activity.id],
    activities: [activity],
    dominantTitle: activity.window_title,
  };
}

/** Fold `source` into `target`, extending the range and totals. */
function absorbBlock(target: ActivityBlock, source: ActivityBlock): void {
  if (new Date(source.endedAt).getTime() > new Date(target.endedAt).getTime()) {
    target.endedAt = source.endedAt;
  }
  target.totalDuration += source.totalDuration;
  target.activityIds.push(...source.activityIds);
  target.activities.push(...source.activities);
}

/**
 * Decide whether `foreign` (sitting between `prev` and `next`) is a short
 * interruption that should be folded into the `prev` session.
 *
 * HARD SAFETY (billing): only ever true when `prev` and `next` carry the SAME
 * merge key — a foreign segment must never bridge two different projects or
 * contexts. Additionally the interruption must NOT already carry its own
 * distinct known project: absorbing folds its ids into the session, and the
 * calendar's bulk-confirm assigns the session's project to every member — so
 * absorbing a segment already classified to another client's project would
 * silently reclassify (and mis-bill) it. `foreign` must genuinely differ from
 * the session, be shorter than `maxInterruptionSeconds`, be shorter than both
 * neighbours, and sit within `maxGapSeconds` of each side.
 */
function isAbsorbableInterruption(
  prev: ActivityBlock,
  foreign: ActivityBlock,
  next: ActivityBlock,
  maxGapSeconds: number,
  maxInterruptionSeconds: number,
): boolean {
  // Same key on both sides — never bridge two different projects/contexts.
  if (prev.key !== next.key) return false;
  // A same-key segment is not an interruption (it would already have merged
  // when adjacent); absorbing it would silently span a real long pause.
  if (foreign.key === prev.key) return false;
  // Billing safety: never absorb an interruption that already has its OWN
  // distinct known project — confirming the session would reclassify it to the
  // session's project. Only unclassified (project-less) detours, or ones that
  // happen to share the session's project, may fold in.
  if (foreign.projectId !== null && foreign.projectId !== prev.projectId) {
    return false;
  }
  // Short detour only.
  if (foreign.totalDuration > maxInterruptionSeconds) return false;
  // The interruption must be smaller than the work it sits between.
  if (foreign.totalDuration >= prev.totalDuration) return false;
  if (foreign.totalDuration >= next.totalDuration) return false;

  const gapBefore =
    (new Date(foreign.startedAt).getTime() - new Date(prev.endedAt).getTime()) /
    1000;
  const gapAfter =
    (new Date(next.startedAt).getTime() - new Date(foreign.endedAt).getTime()) /
    1000;
  return gapBefore <= maxGapSeconds && gapAfter <= maxGapSeconds;
}

/**
 * Fold short foreign interruptions into the session that flanks them.
 *
 * Operates on the already-neighbour-merged, start-ordered blocks. A foreign
 * block is absorbed together with the following same-key block only when it is
 * a genuine short interruption truly flanked by that key (see
 * `isAbsorbableInterruption`). Two consecutive foreign blocks are never fused
 * into one bridge — real flanking of a single segment is required.
 */
function absorbInterruptions(
  blocks: ActivityBlock[],
  maxGapSeconds: number,
  maxInterruptionSeconds: number,
): ActivityBlock[] {
  const out: ActivityBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const prev = out[out.length - 1];
    const foreign = blocks[i];
    const next = blocks[i + 1];
    if (
      prev &&
      next &&
      isAbsorbableInterruption(
        prev,
        foreign,
        next,
        maxGapSeconds,
        maxInterruptionSeconds,
      )
    ) {
      // Fold the interruption and the resuming work into the session.
      absorbBlock(prev, foreign);
      absorbBlock(prev, next);
      i += 2;
    } else {
      out.push(foreign);
      i += 1;
    }
  }
  return out;
}

/**
 * Merge adjacent activities into contiguous blocks.
 *
 * Activities are sorted by `started_at`, then neighbours merge into one block
 * when they share the same merge key (project if set, otherwise app; plus
 * category and confirmed-status) and the gap between the block's end and the
 * next activity's start is at most `maxGapSeconds` (default 180s).
 *
 * A second pass then absorbs short FOREIGN interruptions (e.g. a 30s browser
 * lookup) back into the surrounding session, but only when the SAME merge key
 * flanks the interruption on both sides — so a session's total stays whole
 * without ever bridging two different projects.
 */
export function mergeActivitiesIntoBlocks(
  activities: Activity[],
  opts: MergeOptions = {},
): ActivityBlock[] {
  const maxGapSeconds = opts.maxGapSeconds ?? DEFAULT_MAX_GAP_SECONDS;
  const maxInterruptionSeconds =
    opts.maxInterruptionSeconds ?? DEFAULT_MAX_INTERRUPTION_SECONDS;

  const sorted = [...activities].sort(
    (a, b) =>
      new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );

  const merged: ActivityBlock[] = [];
  for (const activity of sorted) {
    const current = merged[merged.length - 1];
    const gapSeconds = current
      ? (new Date(activity.started_at).getTime() -
          new Date(current.endedAt).getTime()) /
        1000
      : Number.POSITIVE_INFINITY;

    if (
      current &&
      current.key === mergeKey(activity) &&
      gapSeconds <= maxGapSeconds
    ) {
      if (
        new Date(activity.ended_at).getTime() >
        new Date(current.endedAt).getTime()
      ) {
        current.endedAt = activity.ended_at;
      }
      current.totalDuration += activity.duration;
      current.activityIds.push(activity.id);
      current.activities.push(activity);
    } else {
      merged.push(toBlock(activity));
    }
  }

  const blocks = absorbInterruptions(
    merged,
    maxGapSeconds,
    maxInterruptionSeconds,
  );

  for (const block of blocks) {
    let dominant = block.activities[0];
    for (const member of block.activities) {
      if (member.duration > dominant.duration) dominant = member;
    }
    block.dominantTitle = dominant.window_title;
  }

  return blocks;
}

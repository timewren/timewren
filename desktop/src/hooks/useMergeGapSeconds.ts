import { useEffect, useState } from "react";
import { DEFAULT_MAX_GAP_SECONDS } from "@/lib/activityBlocks";
import { tauriInvoke } from "@/lib/tauri";

/**
 * Reads the `activity_merge_gap_seconds` setting — the max pause between
 * adjacent activities that still merge into one ghost block. Falls back to
 * DEFAULT_MAX_GAP_SECONDS when unset or invalid.
 */
export function useMergeGapSeconds(): number {
  const [gapSeconds, setGapSeconds] = useState(DEFAULT_MAX_GAP_SECONDS);

  useEffect(() => {
    tauriInvoke<string | null>("get_setting", {
      key: "activity_merge_gap_seconds",
    })
      .then((value) => {
        const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed >= 0) setGapSeconds(parsed);
      })
      .catch(() => {
        // Setting unavailable — keep default
      });
  }, []);

  return gapSeconds;
}

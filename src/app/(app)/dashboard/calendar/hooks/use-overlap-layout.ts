// src/app/dashboard/calendar/hooks/use-overlap-layout.ts
import { useMemo } from "react";
import { rangesOverlap } from "../utils/calendar-math";

export interface BlockLayout {
  blockId: string;
  column: number;
  totalColumns: number;
  left: string;
  width: string;
  hasOverlap: boolean;
}

interface BlockTiming {
  id: string;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Compute side-by-side column layout for overlapping time blocks.
 * Returns a map from blockId to its layout info (column position, width).
 *
 * Algorithm:
 * 1. Sort blocks by start time
 * 2. Group overlapping blocks into clusters
 * 3. Within each cluster, assign column indices greedily
 * 4. Compute CSS left/width from column assignment
 */
export function computeOverlapLayout(
  blocks: BlockTiming[],
): Map<string, BlockLayout> {
  const result = new Map<string, BlockLayout>();
  if (blocks.length === 0) return result;

  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);

  // Find connected overlap clusters
  const visited = new Set<string>();
  const clusters: BlockTiming[][] = [];

  for (const block of sorted) {
    if (visited.has(block.id)) continue;

    // BFS to find all blocks in this overlap cluster
    const cluster: BlockTiming[] = [];
    const queue = [block];
    visited.add(block.id);

    // Køen vokser undervejs, så der gås indeks for indeks (samme rækkefølge som shift)
    for (let qi = 0; qi < queue.length; qi++) {
      const current = queue[qi];
      cluster.push(current);

      for (const other of sorted) {
        if (visited.has(other.id)) continue;
        if (
          rangesOverlap(
            current.startMinutes,
            current.endMinutes,
            other.startMinutes,
            other.endMinutes,
          )
        ) {
          visited.add(other.id);
          queue.push(other);
        }
      }
    }

    clusters.push(cluster);
  }

  // Assign columns within each cluster
  for (const cluster of clusters) {
    if (cluster.length === 1) {
      result.set(cluster[0].id, {
        blockId: cluster[0].id,
        column: 0,
        totalColumns: 1,
        left: "0%",
        width: "100%",
        hasOverlap: false,
      });
      continue;
    }

    // Sort cluster by start time for greedy assignment
    cluster.sort((a, b) => a.startMinutes - b.startMinutes);

    // columnEnds[i] = end time of last block placed in column i
    const columnEnds: number[] = [];
    const assignments = new Map<string, number>();

    for (const block of cluster) {
      // Find first column where this block fits (no overlap)
      let placed = false;
      for (let col = 0; col < columnEnds.length; col++) {
        if (columnEnds[col] <= block.startMinutes) {
          columnEnds[col] = block.endMinutes;
          assignments.set(block.id, col);
          placed = true;
          break;
        }
      }
      if (!placed) {
        assignments.set(block.id, columnEnds.length);
        columnEnds.push(block.endMinutes);
      }
    }

    const totalColumns = columnEnds.length;
    const gap = 2; // px gap between columns

    for (const block of cluster) {
      const col = assignments.get(block.id) ?? 0;
      const widthPercent = 100 / totalColumns;
      result.set(block.id, {
        blockId: block.id,
        column: col,
        totalColumns,
        left: `calc(${col * widthPercent}% + ${col > 0 ? gap : 0}px)`,
        width: `calc(${widthPercent}% - ${gap}px)`,
        hasOverlap: true,
      });
    }
  }

  return result;
}

/**
 * React hook wrapper around computeOverlapLayout.
 */
export function useOverlapLayout(
  blocks: BlockTiming[],
): Map<string, BlockLayout> {
  return useMemo(() => computeOverlapLayout(blocks), [blocks]);
}

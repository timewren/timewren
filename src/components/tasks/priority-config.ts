export const PRIORITY_CONFIG = {
  urgent: {
    color: "#ef4444",
    textColor: "text-red-600",
    bg: "bg-red-50 dark:bg-red-900/20",
  },
  high: {
    color: "#f59e0b",
    textColor: "text-orange-600",
    bg: "bg-orange-50 dark:bg-orange-900/20",
  },
  medium: {
    color: "#d1d5db",
    textColor: "text-gray-600",
    bg: "bg-gray-100 dark:bg-gray-700",
  },
  low: {
    color: "#d1d5db",
    textColor: "text-gray-500",
    bg: "bg-gray-100 dark:bg-gray-700",
  },
} as const;

export type PriorityKey = keyof typeof PRIORITY_CONFIG;

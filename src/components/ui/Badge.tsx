"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { useUiText } from "./use-ui-text";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";
export type BadgeSize = "sm" | "md" | "lg";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  primary: "bg-tt-gran-lys text-tt-gran",
  success:
    "bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400",
  warning:
    "bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400",
  danger:
    "bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const dotStyles: Record<BadgeVariant, string> = {
  default: "bg-gray-500",
  primary: "bg-tt-gran",
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  info: "bg-blue-500",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-0.5 text-sm",
  lg: "px-3 py-1 text-sm",
};

export function Badge({
  variant = "default",
  size = "md",
  dot = false,
  children,
  className = "",
  ...props
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        font-medium rounded-full
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `.trim()}
      {...props}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${dotStyles[variant]}`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

// Status badge for common use cases
type StatusType =
  | "active"
  | "inactive"
  | "pending"
  | "completed"
  | "archived"
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "on_hold";

const statusConfig: Record<StatusType, { variant: BadgeVariant }> = {
  active: { variant: "success" },
  inactive: { variant: "default" },
  pending: { variant: "warning" },
  completed: { variant: "success" },
  archived: { variant: "default" },
  draft: { variant: "default" },
  sent: { variant: "info" },
  paid: { variant: "success" },
  overdue: { variant: "danger" },
  on_hold: { variant: "warning" },
};

interface StatusBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  status: StatusType;
  customLabel?: string;
}

export function StatusBadge({
  status,
  customLabel,
  ...props
}: StatusBadgeProps) {
  const t = useUiText();
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} dot {...props}>
      {customLabel || t(`status.${status}`)}
    </Badge>
  );
}

// Priority badge
type PriorityType = "low" | "medium" | "high" | "urgent";

const priorityConfig: Record<PriorityType, { variant: BadgeVariant }> = {
  low: { variant: "default" },
  medium: { variant: "info" },
  high: { variant: "warning" },
  urgent: { variant: "danger" },
};

interface PriorityBadgeProps extends Omit<BadgeProps, "variant" | "children"> {
  priority: PriorityType;
  customLabel?: string;
}

export function PriorityBadge({
  priority,
  customLabel,
  ...props
}: PriorityBadgeProps) {
  const t = useUiText();
  const config = priorityConfig[priority];
  return (
    <Badge variant={config.variant} {...props}>
      {customLabel || t(`priority.${priority}`)}
    </Badge>
  );
}

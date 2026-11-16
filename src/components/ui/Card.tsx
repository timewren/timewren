"use client";

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingStyles = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export function Card({
  children,
  hover = false,
  padding = "md",
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`
        bg-white dark:bg-gray-800
        border border-gray-200 dark:border-gray-700
        rounded-lg shadow-card
        ${hover ? "transition-shadow hover:shadow-card-hover" : ""}
        ${paddingStyles[padding]}
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  action?: ReactNode;
}

export function CardHeader({
  children,
  action,
  className = "",
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={`
        flex items-center justify-between
        pb-3 mb-3
        border-b border-gray-200 dark:border-gray-700
        ${className}
      `.trim()}
      {...props}
    >
      <div className="font-semibold text-gray-900 dark:text-gray-100">
        {children}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export function CardTitle({
  children,
  as: Tag = "h3",
  className = "",
  ...props
}: CardTitleProps) {
  return (
    <Tag
      className={`
        text-base font-semibold text-gray-900 dark:text-gray-100
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </Tag>
  );
}

interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function CardDescription({
  children,
  className = "",
  ...props
}: CardDescriptionProps) {
  return (
    <p
      className={`
        text-sm text-gray-500 dark:text-gray-400 mt-1
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </p>
  );
}

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardContent({
  children,
  className = "",
  ...props
}: CardContentProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardFooter({
  children,
  className = "",
  ...props
}: CardFooterProps) {
  return (
    <div
      className={`
        flex items-center justify-end gap-2
        pt-3 mt-3
        border-t border-gray-200 dark:border-gray-700
        ${className}
      `.trim()}
      {...props}
    >
      {children}
    </div>
  );
}

// Skeleton card for loading states
interface CardSkeletonProps {
  lines?: number;
  showHeader?: boolean;
  showFooter?: boolean;
}

export function CardSkeleton({
  lines = 3,
  showHeader = true,
  showFooter = false,
}: CardSkeletonProps) {
  return (
    <Card>
      {showHeader && (
        <div className="pb-3 mb-3 border-b border-gray-200 dark:border-gray-700">
          <div className="h-5 w-1/3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
            key={i}
            className={`h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ${
              i === lines - 1 ? "w-2/3" : "w-full"
            }`}
          />
        ))}
      </div>
      {showFooter && (
        <div className="pt-3 mt-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <div className="h-9 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-9 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      )}
    </Card>
  );
}

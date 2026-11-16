"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "outline";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

// Farver fra brand-tokens (docs/BRAND.md): granskov med hvid tekst i lys,
// #5FB38F med mørk tekst i mørk (tt-paa-gran). Sekundær- og outline-knapper
// har kant i tt-kant (mindst 3:1, WCAG 1.4.11).
const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk active:bg-tt-gran-moerk",
  secondary:
    "bg-tt-flade text-tt-blaek border border-tt-kant hover:bg-tt-streg active:bg-tt-streg",
  danger: "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700",
  ghost: "bg-transparent text-tt-blaek hover:bg-tt-flade active:bg-tt-streg",
  outline:
    "bg-transparent border border-tt-kant text-tt-blaek hover:bg-tt-flade active:bg-tt-streg",
};

// Trykflader: mindst 44 px høje på mobil og 24 px på desktop (BRAND.md).
const sizeStyles: Record<ButtonSize, string> = {
  sm: "min-h-6 px-2.5 py-1 text-sm gap-1.5",
  md: "min-h-11 sm:min-h-8 px-3 py-1.5 text-sm gap-2",
  lg: "min-h-11 px-5 py-2.5 text-base gap-2.5",
};

const iconSizes: Record<ButtonSize, string> = {
  sm: "h-4 w-4",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center
          font-medium rounded-lg
          transition-all duration-150
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus
          disabled:cursor-not-allowed disabled:opacity-60
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? "w-full" : ""}
          ${className}
        `.trim()}
        {...props}
      >
        {isLoading ? (
          <Loader2 className={`animate-spin ${iconSizes[size]}`} />
        ) : leftIcon ? (
          <span className={iconSizes[size]}>{leftIcon}</span>
        ) : null}
        {children}
        {!isLoading && rightIcon && (
          <span className={iconSizes[size]}>{rightIcon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";

// Convenience exports for common button patterns
export function PrimaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="primary" {...props} />;
}

export function SecondaryButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="secondary" {...props} />;
}

export function DangerButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="danger" {...props} />;
}

export function GhostButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="ghost" {...props} />;
}

export function OutlineButton(props: Omit<ButtonProps, "variant">) {
  return <Button variant="outline" {...props} />;
}

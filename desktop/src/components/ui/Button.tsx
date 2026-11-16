import { forwardRef } from "react";

const variantClasses = {
  primary:
    "bg-(--color-accent) text-white hover:bg-(--color-accent-hover) active:brightness-90",
  secondary:
    "bg-(--color-surface) border border-(--color-border) text-(--color-text) hover:bg-(--color-border)/50",
  ghost:
    "bg-transparent text-(--color-text-muted) hover:bg-(--color-border)/40 hover:text-(--color-text)",
  danger: "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
} as const;

const sizeClasses = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2.5",
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50 focus-visible:ring-offset-1 focus-visible:ring-offset-(--color-bg) disabled:pointer-events-none disabled:opacity-50 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className = "", id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20 disabled:opacity-50 ${className}`}
          {...props}
        />
      </div>
    );
  },
);

Input.displayName = "Input";

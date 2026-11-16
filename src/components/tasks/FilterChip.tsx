"use client";

export function FilterChip({
  label,
  value,
  options,
  activeColor,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  activeColor: string;
  onChange: (value: string) => void;
}) {
  const isActive = value !== "all";
  return (
    // max-w + truncate: en select er ellers lige så bred som den længste
    // mulighed, og et langt kundenavn skubbede siden ud over 375 px.
    // Fokusringen kommer fra den globale :focus-visible-stil.
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={`
        max-w-[11rem] truncate rounded-full px-3 py-1 text-[11px] font-medium border-0 cursor-pointer
        appearance-none bg-no-repeat bg-[length:12px] bg-[right_6px_center]
        pr-5
        ${
          isActive
            ? activeColor
            : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
        }
      `}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.value === "all" ? label : opt.label}
        </option>
      ))}
    </select>
  );
}

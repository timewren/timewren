"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useUiText } from "./use-ui-text";

interface BaseProps {
  clients:
    | Array<{
        id: string;
        name: string;
        isArchived?: boolean | null;
        timeEntryCount?: number;
      }>
    | undefined;
  disabled?: boolean;
  placeholder?: string;
  /** Allow clearing selection */
  allowClear?: boolean;
  /** Label for the clear option (default "Ingen klient") */
  clearLabel?: string;
  /** id for the combobox trigger, so an external <label htmlFor> can target it */
  id?: string;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string;
  onChange: (id: string) => void;
}

interface MultiProps extends BaseProps {
  /** Multi-select: valg toggler, dropdown forbliver åben */
  multiple: true;
  values: string[];
  onValuesChange: (ids: string[]) => void;
}

type ClientSearchComboboxProps = SingleProps | MultiProps;

export function ClientSearchCombobox(props: ClientSearchComboboxProps) {
  const { clients, disabled, allowClear, id } = props;
  const tUi = useUiText();
  const placeholder = props.placeholder ?? tUi("client.placeholder");
  const clearLabel = props.clearLabel ?? tUi("client.clear");
  const multiple = props.multiple === true;
  const selectedIds = props.multiple
    ? props.values
    : props.value
      ? [props.value]
      : [];

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const inputId = useId();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeClients = clients
    ?.filter((c) => !c.isArchived)
    .sort((a, b) => (b.timeEntryCount ?? 0) - (a.timeEntryCount ?? 0));

  const filtered = search
    ? activeClients?.filter((c) =>
        c.name.toLowerCase().includes(search.toLowerCase()),
      )
    : activeClients;

  const selectedClients =
    activeClients?.filter((c) => selectedIds.includes(c.id)) ?? [];

  // Split into frequently used and others
  const frequentClients = filtered?.filter((c) => (c.timeEntryCount ?? 0) > 0);
  const otherClients = filtered?.filter((c) => (c.timeEntryCount ?? 0) === 0);

  // Flat option list for keyboard navigation (mirrors render order)
  const flatOptions: Array<{ id: string; name: string }> = [
    ...(allowClear ? [{ id: "", name: clearLabel }] : []),
    ...(frequentClients ?? []),
    ...(otherClients ?? []),
  ];
  const clearOffset = allowClear ? 1 : 0;
  const frequentOffset = clearOffset + (frequentClients?.length ?? 0);

  const selectOption = (optionId: string) => {
    if (props.multiple) {
      if (optionId === "") {
        props.onValuesChange([]);
      } else {
        props.onValuesChange(
          props.values.includes(optionId)
            ? props.values.filter((v) => v !== optionId)
            : [...props.values, optionId],
        );
      }
      // Multi-select: hold dropdown åben så flere kan vælges
      return;
    }
    props.onChange(optionId);
    setOpen(false);
    setSearch("");
    setHighlight(-1);
  };

  // Fresh highlight every time the dropdown opens
  useEffect(() => {
    if (open) setHighlight(-1);
  }, [open]);

  // Keep the highlighted option visible while arrowing through the list
  useEffect(() => {
    if (highlight < 0) return;
    containerRef.current
      ?.querySelector(`[data-option-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flatOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // No explicit highlight: pick the top search hit (skip the clear option)
      const option =
        flatOptions[highlight] ??
        (search ? flatOptions.find((o) => o.id !== "") : undefined);
      if (option) selectOption(option.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setSearch("");
      setHighlight(-1);
    }
  };

  const triggerLabel = multiple
    ? selectedClients.length === 0
      ? placeholder
      : selectedClients.length === 1
        ? selectedClients[0].name
        : tUi("client.selected", { count: selectedClients.length })
    : (selectedClients[0]?.name ?? placeholder);
  const hasSelection = selectedClients.length > 0;

  const isSelected = (clientId: string) => selectedIds.includes(clientId);

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open && !disabled) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        className="flex w-full items-center justify-between rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2 text-left text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none disabled:opacity-50"
      >
        <span
          className={hasSelection ? "" : "text-gray-500 dark:text-gray-400"}
        >
          {triggerLabel}
        </span>
        <ChevronsUpDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
          <div className="flex items-center border-b border-gray-200 dark:border-gray-600 px-3">
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            {/* biome-ignore lint/a11y/useSemanticElements: tekstfelt med searchbox-rolle; type=search ville give browserens egen ryd-knap og anden styling */}
            <input
              id={inputId}
              type="text"
              role="searchbox"
              aria-label={tUi("client.searchLabel")}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlight(-1);
              }}
              onKeyDown={handleInputKeyDown}
              aria-activedescendant={
                highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined
              }
              placeholder={tUi("client.searchPlaceholder")}
              className="w-full bg-transparent px-2 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
              // biome-ignore lint/a11y/noAutofocus: search input should focus when dropdown opens
              autoFocus
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label={tUi("client.listLabel")}
            aria-multiselectable={multiple || undefined}
            className="max-h-60 overflow-y-auto p-1"
          >
            {allowClear && (
              <button
                id={`${listboxId}-opt-0`}
                data-option-index={0}
                type="button"
                onClick={() => selectOption("")}
                onMouseEnter={() => setHighlight(0)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-500 dark:text-gray-400 ${
                  highlight === 0 ? "bg-brand-50 dark:bg-gray-700" : ""
                }`}
              >
                <span>{clearLabel}</span>
                {selectedIds.length === 0 && (
                  <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                )}
              </button>
            )}
            {filtered?.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-500">
                {tUi("client.none")}
              </p>
            )}
            {frequentClients && frequentClients.length > 0 && (
              <>
                <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                  {tUi("client.frequent")}
                </p>
                {frequentClients.map((client, i) => (
                  <button
                    key={client.id}
                    id={`${listboxId}-opt-${clearOffset + i}`}
                    data-option-index={clearOffset + i}
                    type="button"
                    role="option"
                    aria-selected={isSelected(client.id)}
                    onClick={() => selectOption(client.id)}
                    onMouseEnter={() => setHighlight(clearOffset + i)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-900 dark:text-white ${
                      highlight === clearOffset + i
                        ? "bg-brand-50 dark:bg-gray-700"
                        : ""
                    }`}
                  >
                    <span>{client.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {tUi("client.entryCount", {
                          count: client.timeEntryCount ?? 0,
                        })}
                      </span>
                      {isSelected(client.id) && (
                        <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                      )}
                    </div>
                  </button>
                ))}
              </>
            )}
            {otherClients && otherClients.length > 0 && (
              <>
                {frequentClients && frequentClients.length > 0 && (
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {tUi("client.all")}
                  </p>
                )}
                {otherClients.map((client, i) => (
                  <button
                    key={client.id}
                    id={`${listboxId}-opt-${frequentOffset + i}`}
                    data-option-index={frequentOffset + i}
                    type="button"
                    role="option"
                    aria-selected={isSelected(client.id)}
                    onClick={() => selectOption(client.id)}
                    onMouseEnter={() => setHighlight(frequentOffset + i)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-900 dark:text-white ${
                      highlight === frequentOffset + i
                        ? "bg-brand-50 dark:bg-gray-700"
                        : ""
                    }`}
                  >
                    <span>{client.name}</span>
                    {isSelected(client.id) && (
                      <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

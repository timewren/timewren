"use client";

import { ChevronDown, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc-provider";

interface TemplateInsertDropdownProps {
  onInsert: (body: string) => void;
  ticketContext?: {
    senderName?: string;
    senderEmail?: string;
    subject?: string;
    company?: string;
  };
  agentName?: string;
}

export function TemplateInsertDropdown({
  onInsert,
  ticketContext,
  agentName,
}: TemplateInsertDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: templates } =
    trpc.admin.supportTemplates.listTemplates.useQuery();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const replaceVariables = (body: string): string => {
    return body
      .replace(/\{name\}/g, ticketContext?.senderName ?? "")
      .replace(/\{email\}/g, ticketContext?.senderEmail ?? "")
      .replace(/\{company\}/g, ticketContext?.company ?? "")
      .replace(/\{ticket_subject\}/g, ticketContext?.subject ?? "")
      .replace(/\{agent_name\}/g, agentName ?? "");
  };

  const systemTemplates = templates?.filter((t) => t.scope === "system") ?? [];
  const personalTemplates =
    templates?.filter((t) => t.scope === "personal") ?? [];

  if (!templates || templates.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <FileText className="h-3.5 w-3.5" />
        Indsæt skabelon
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-72 rounded-lg border bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {systemTemplates.length > 0 && (
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                System
              </p>
              {systemTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onInsert(replaceVariables(t.body));
                    setOpen(false);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          {personalTemplates.length > 0 && (
            <div className="border-t p-2 dark:border-gray-700">
              <p className="px-2 py-1 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                Mine
              </p>
              {personalTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onInsert(replaceVariables(t.body));
                    setOpen(false);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { FolderOpen, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientList } from "@/components/projects/ClientList";
import { ProjectList } from "@/components/projects/ProjectList";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});

type TabId = "clients" | "projects";

function ProjectsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("clients");

  const tabs = [
    { id: "clients" as const, label: t("projects.clients"), icon: Users },
    {
      id: "projects" as const,
      label: t("projects.projects"),
      icon: FolderOpen,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-(--color-text)">
          {t("projects.title")}
        </h1>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          {t("projects.title")}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg bg-(--color-bg) border border-(--color-border) p-1 w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "text-(--color-text)"
                  : "text-(--color-text-muted) hover:text-(--color-text)"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="projects-tab-indicator"
                  className="absolute inset-0 rounded-md bg-(--color-surface) border border-(--color-border) shadow-sm"
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                />
              )}
              <span className="relative z-10 flex items-center gap-2">
                <Icon size={14} />
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "clients" ? <ClientList /> : <ProjectList />}
    </div>
  );
}

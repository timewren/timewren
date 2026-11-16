import { createFileRoute } from "@tanstack/react-router";
import { ReportView } from "@/components/reports/ReportView";

export const Route = createFileRoute("/reports")({
  component: ReportPage,
});

function ReportPage() {
  return <ReportView />;
}

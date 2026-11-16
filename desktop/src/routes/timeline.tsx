import { createFileRoute } from "@tanstack/react-router";
import { TimelineView } from "@/components/timeline/TimelineView";

export const Route = createFileRoute("/timeline")({
  component: TimelinePage,
});

function TimelinePage() {
  return <TimelineView />;
}

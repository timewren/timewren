export interface TimeBlock {
  id: string;
  rawId: string;
  title: string;
  startTime: Date;
  endTime: Date;
  type: "event" | "entry";
  projectName?: string;
  clientName?: string;
  linkedProjectId?: string | null;
  linkedTimeEntryId?: string | null;
  isAllDay?: boolean | null;
  responseStatus?: string | null;
  description?: string | null;
  clientColor?: string;
  isContinuation?: boolean; // This block is the second part (starts at 00:00)
  continues?: boolean; // This block continues to next day (ends at 23:59)
  taskId?: string | null; // For same-task color grouping
}

export interface ClientMatch {
  clientId: string;
  clientName: string;
  projectId?: string;
  projectName?: string;
  score: number;
  source: string;
}

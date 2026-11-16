import { parseCSV } from "./csv-parser";

export interface TodoistTask {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  deadline: Date | null;
  estimatedMinutes: number | null;
  indent: number;
  status: "done" | "backlog";
}

export interface TodoistParsed {
  projectName: string;
  tasks: TodoistTask[];
}

/**
 * Parse a Todoist CSV export.
 * Todoist backup exports a CSV per project. The projectName is derived from
 * section rows (TYPE=section) or should be passed explicitly.
 */
export function parseTodoistCSV(
  csvContent: string,
  fallbackProjectName: string,
): TodoistParsed {
  const rows = parseCSV(csvContent);
  const tasks: TodoistTask[] = [];
  let projectName = fallbackProjectName;

  for (const row of rows) {
    const type = (row.TYPE || row.type || "").toLowerCase();

    // Section rows define the project name
    if (type === "section") {
      const sectionName = row.CONTENT || row.content || "";
      if (sectionName) projectName = sectionName;
      continue;
    }

    // Note rows: append to previous task's description
    if (type === "note") {
      const noteContent = row.CONTENT || row.content || "";
      if (noteContent && tasks.length > 0) {
        const lastTask = tasks[tasks.length - 1];
        lastTask.description = lastTask.description
          ? `${lastTask.description}\n${noteContent}`
          : noteContent;
      }
      continue;
    }

    // Task rows
    if (type !== "task" && type !== "") continue;

    const content = row.CONTENT || row.content || "";
    if (!content) continue;

    const description = row.DESCRIPTION || row.description || "";

    // Priority: Todoist uses 1=urgent, 2=high, 3=medium, 4=low (inverted!)
    const priorityNum = Number.parseInt(
      row.PRIORITY || row.priority || "4",
      10,
    );
    const priority = mapTodoistPriority(priorityNum);

    // Indent for hierarchy
    const indent = Number.parseInt(row.INDENT || row.indent || "1", 10);

    // Deadline
    const dateStr = row.DATE || row.date || "";
    let deadline: Date | null = null;
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!Number.isNaN(parsed.getTime())) deadline = parsed;
    }

    // Duration
    let estimatedMinutes: number | null = null;
    const durationStr = row.DURATION || row.duration || "";
    const durationUnit = (
      row.DURATION_UNIT ||
      row.duration_unit ||
      "minute"
    ).toLowerCase();
    if (durationStr) {
      const dur = Number.parseInt(durationStr, 10);
      if (!Number.isNaN(dur) && dur > 0) {
        estimatedMinutes =
          durationUnit === "hour" || durationUnit === "hours" ? dur * 60 : dur;
      }
    }

    // Status based on CHECKED column
    const checked = row.CHECKED || row.checked || "0";
    const status = checked === "1" ? "done" : "backlog";

    tasks.push({
      title: content,
      description,
      priority,
      deadline,
      estimatedMinutes,
      indent,
      status,
    });
  }

  return { projectName, tasks };
}

function mapTodoistPriority(num: number): "low" | "medium" | "high" | "urgent" {
  switch (num) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    default:
      return "low";
  }
}

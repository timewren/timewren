import {
  addDaysToDateStr,
  copenhagenToday,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import {
  DEFAULT_MODEL,
  getOpenAI,
  getOpenAIForUser,
  isAIEnabled,
  isAIEnabledForUser,
} from "./openai";
import {
  buildSafePrompt,
  detectInjectionAttempt,
  sanitizeForPrompt,
} from "./sanitize";

const PRIORITIZATION_SYSTEM_PROMPT = `Du er en produktivitetsekspert der hjælper freelancere med at prioritere deres opgaver.
Din opgave er at analysere en liste af opgaver og foreslå en prioriteret rækkefølge for dagens/ugens arbejde.

Faktorer at overveje (i prioriteret rækkefølge):
1. Deadline-nærhed (overskredet > i dag > inden 3 dage > denne uge)
2. Eksplicit prioritet (urgent > high > medium > low)
3. Estimeret tid vs. tilgængelig tid
4. Projektets vigtighed
5. Blokerende afhængigheder

Filosofi:
- Hjælp brugeren med at fokusere på det vigtigste først
- Undgå kontekstskift - grupper relaterede opgaver
- Foreslå realistiske dagsmål (6-8 timers effektiv arbejdstid)
- Fremhæv opgaver der risikerer at blive glemt

VIGTIGT: Svar KUN med valid JSON. Ingen markdown, ingen forklaringer.`;

const PRIORITIZATION_USER_TEMPLATE = `Prioriter følgende opgaver for {period}:

Opgaver:
{tasks}

Brugerens tilgængelige tid: {availableHours} timer
Dagens dato: {today}

Svar med JSON i dette format:
{
  "focusTasks": [
    {
      "taskId": "string",
      "rank": 1,
      "reason": "kort begrundelse",
      "suggestedTimeBlock": "fx 09:00-11:00"
    }
  ],
  "deferredTasks": [
    {
      "taskId": "string",
      "reason": "hvorfor udskudt",
      "suggestedDate": "ISO-date | null"
    }
  ],
  "warnings": [
    {
      "taskId": "string",
      "type": "overdue | deadline_soon | blocked | too_many_urgent",
      "message": "advarselstekst"
    }
  ],
  "summary": "kort oversigt over dagens/ugens fokus"
}`;

export interface TaskForPrioritization {
  id: string;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  deadline?: Date | null;
  estimatedMinutes?: number | null;
  projectName?: string | null;
  status: string;
}

export interface FocusTask {
  taskId: string;
  rank: number;
  reason: string;
  suggestedTimeBlock?: string;
}

export interface DeferredTask {
  taskId: string;
  reason: string;
  suggestedDate?: string | null;
}

export interface PrioritizationWarning {
  taskId: string;
  type: "overdue" | "deadline_soon" | "blocked" | "too_many_urgent";
  message: string;
}

export interface PrioritizationResult {
  focusTasks: FocusTask[];
  deferredTasks: DeferredTask[];
  warnings: PrioritizationWarning[];
  summary: string;
}

/**
 * Calculate a priority score for a task (higher = more urgent)
 */
function calculatePriorityScore(task: TaskForPrioritization): number {
  let score = 0;
  const now = new Date();

  // Priority weight
  const priorityWeights = { urgent: 100, high: 60, medium: 30, low: 10 };
  score += priorityWeights[task.priority] || 30;

  // Deadline proximity
  if (task.deadline) {
    const deadline = new Date(task.deadline);
    const daysUntil = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil < 0) {
      score += 200; // Overdue
    } else if (daysUntil === 0) {
      score += 150; // Due today
    } else if (daysUntil <= 3) {
      score += 100 - daysUntil * 20; // Due soon
    } else if (daysUntil <= 7) {
      score += 30; // This week
    }
  }

  return score;
}

/**
 * Prioritize tasks using a scoring algorithm (fast, no AI)
 */
export function scorePrioritization(
  tasks: TaskForPrioritization[],
  availableMinutes: number = 480, // 8 hours default
): PrioritizationResult {
  const now = new Date();

  // Score and sort tasks
  const scoredTasks = tasks
    .filter((t) => t.status !== "done")
    .map((task) => ({
      task,
      score: calculatePriorityScore(task),
    }))
    .sort((a, b) => b.score - a.score);

  const focusTasks: FocusTask[] = [];
  const deferredTasks: DeferredTask[] = [];
  const warnings: PrioritizationWarning[] = [];

  let remainingMinutes = availableMinutes;
  let currentTime = 9 * 60; // Start at 9:00

  for (const { task, score } of scoredTasks) {
    const taskMinutes = task.estimatedMinutes || 60; // Default 1 hour

    // Check for warnings
    if (task.deadline) {
      const deadline = new Date(task.deadline);
      const daysUntil = Math.ceil(
        (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntil < 0) {
        warnings.push({
          taskId: task.id,
          type: "overdue",
          message: `Deadline overskredet med ${Math.abs(daysUntil)} dag${Math.abs(daysUntil) > 1 ? "e" : ""}`,
        });
      } else if (daysUntil <= 1) {
        warnings.push({
          taskId: task.id,
          type: "deadline_soon",
          message: daysUntil === 0 ? "Deadline i dag!" : "Deadline i morgen",
        });
      }
    }

    // Add to focus if time allows
    if (remainingMinutes >= taskMinutes && focusTasks.length < 5) {
      const startHour = Math.floor(currentTime / 60);
      const startMin = currentTime % 60;
      const endTime = currentTime + taskMinutes;
      const endHour = Math.floor(endTime / 60);
      const endMin = endTime % 60;

      focusTasks.push({
        taskId: task.id,
        rank: focusTasks.length + 1,
        reason: getPriorityReason(task, score),
        suggestedTimeBlock: `${startHour.toString().padStart(2, "0")}:${startMin.toString().padStart(2, "0")}-${endHour.toString().padStart(2, "0")}:${endMin.toString().padStart(2, "0")}`,
      });

      remainingMinutes -= taskMinutes;
      currentTime = endTime + 15; // 15 min break between tasks
    } else {
      deferredTasks.push({
        taskId: task.id,
        reason:
          focusTasks.length >= 5
            ? "For mange opgaver i dag"
            : "Ikke nok tid i dag",
        suggestedDate: task.deadline ? undefined : getTomorrowDate(),
      });
    }
  }

  // Check for too many urgent tasks
  const urgentCount = tasks.filter(
    (t) => t.priority === "urgent" && t.status !== "done",
  ).length;
  if (urgentCount > 3) {
    warnings.push({
      taskId: "",
      type: "too_many_urgent",
      message: `Du har ${urgentCount} urgente opgaver. Overvej at re-prioritere.`,
    });
  }

  // Generate summary
  const totalFocusMinutes =
    focusTasks.length > 0
      ? scoredTasks
          .filter((st) => focusTasks.some((ft) => ft.taskId === st.task.id))
          .reduce((sum, st) => sum + (st.task.estimatedMinutes || 60), 0)
      : 0;

  const summary =
    focusTasks.length > 0
      ? `Fokuser på ${focusTasks.length} opgaver i dag (ca. ${Math.round(totalFocusMinutes / 60)} timer). ${warnings.length > 0 ? `OBS: ${warnings.length} advarsler.` : ""}`
      : "Ingen opgaver at prioritere.";

  return { focusTasks, deferredTasks, warnings, summary };
}

/**
 * Prioritize tasks using AI for smarter suggestions
 * @param tasks - The tasks to prioritize
 * @param availableHours - Available hours (default 8)
 * @param period - "day" or "week"
 * @param userId - Optional user ID for user-specific AI configuration
 */
export async function aiPrioritization(
  tasks: TaskForPrioritization[],
  availableHours: number = 8,
  period: "day" | "week" = "day",
  userId?: string,
): Promise<PrioritizationResult> {
  // Always do score-based first
  const scoreResult = scorePrioritization(tasks, availableHours * 60);

  // Check if AI is enabled (user-specific or system-level)
  const aiEnabled = userId ? await isAIEnabledForUser(userId) : isAIEnabled();
  if (!aiEnabled || tasks.length === 0) {
    return scoreResult;
  }

  try {
    const today = copenhagenToday();

    // Check for injection attempts in task titles
    const potentialInjection = tasks.some((t) =>
      detectInjectionAttempt(t.title),
    );
    if (potentialInjection) {
      console.warn(
        "Potential prompt injection attempt detected in task prioritization",
      );
    }

    // Format tasks for the prompt (sanitized titles, limited to 30 tasks)
    const tasksText = tasks
      .filter((t) => t.status !== "done")
      .slice(0, 30) // Limit tasks to control token usage
      .map((t) => {
        const deadline = t.deadline
          ? toCopenhagenDateStr(new Date(t.deadline))
          : "ingen";
        const estimate = t.estimatedMinutes
          ? `${t.estimatedMinutes} min`
          : "ukendt";
        const sanitizedTitle = sanitizeForPrompt(t.title, {
          maxLength: 100,
          allowNewlines: false,
        });
        const sanitizedProject = t.projectName
          ? sanitizeForPrompt(t.projectName, {
              maxLength: 50,
              allowNewlines: false,
            })
          : null;
        return `- [${t.id}] "${sanitizedTitle}" | Prioritet: ${t.priority} | Deadline: ${deadline} | Estimat: ${estimate}${sanitizedProject ? ` | Projekt: ${sanitizedProject}` : ""}`;
      })
      .join("\n");

    const userPrompt = buildSafePrompt(PRIORITIZATION_USER_TEMPLATE, {
      period: period === "day" ? "i dag" : "denne uge",
      tasks: tasksText,
      availableHours: availableHours.toString(),
      today: today,
    });

    // Get AI client (user-specific or system-level)
    const { client, model } = userId
      ? await getOpenAIForUser(userId)
      : { client: getOpenAI(), model: DEFAULT_MODEL };

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: PRIORITIZATION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as PrioritizationResult;

    // Validate task IDs exist
    const taskIds = new Set(tasks.map((t) => t.id));
    parsed.focusTasks = (parsed.focusTasks || []).filter((ft) =>
      taskIds.has(ft.taskId),
    );
    parsed.deferredTasks = (parsed.deferredTasks || []).filter((dt) =>
      taskIds.has(dt.taskId),
    );
    parsed.warnings = (parsed.warnings || []).filter(
      (w) => !w.taskId || taskIds.has(w.taskId),
    );

    return {
      focusTasks: parsed.focusTasks,
      deferredTasks: parsed.deferredTasks,
      warnings: [...scoreResult.warnings, ...parsed.warnings].slice(0, 5),
      summary: parsed.summary || scoreResult.summary,
    };
  } catch (error) {
    console.error("AI prioritization failed:", error);
    return scoreResult;
  }
}

/**
 * Get today's focus tasks (convenience function)
 */
export function getTodaysFocus(
  tasks: TaskForPrioritization[],
  maxTasks: number = 3,
): TaskForPrioritization[] {
  const result = scorePrioritization(tasks);
  const focusIds = result.focusTasks.slice(0, maxTasks).map((ft) => ft.taskId);
  return tasks.filter((t) => focusIds.includes(t.id));
}

/**
 * Get priority reason text
 */
function getPriorityReason(
  task: TaskForPrioritization,
  _score: number,
): string {
  if (task.deadline) {
    const now = new Date();
    const deadline = new Date(task.deadline);
    const daysUntil = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntil < 0) return "Overskredet deadline";
    if (daysUntil === 0) return "Deadline i dag";
    if (daysUntil === 1) return "Deadline i morgen";
    if (daysUntil <= 3) return `Deadline om ${daysUntil} dage`;
  }

  if (task.priority === "urgent") return "Markeret som urgent";
  if (task.priority === "high") return "Høj prioritet";

  return "Anbefalet baseret på prioritering";
}

/**
 * Get tomorrow's date as ISO string
 */
function getTomorrowDate(): string {
  return addDaysToDateStr(copenhagenToday(), 1);
}

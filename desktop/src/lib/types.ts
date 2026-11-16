// --- Client types ---

export interface Client {
  id: string;
  remote_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  cvr: string | null;
  hourly_rate: number | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface CreateClientInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  cvr?: string | null;
  hourly_rate?: number | null;
  notes?: string | null;
}

// --- Project input types ---

export interface CreateProjectInput {
  client_id?: string | null;
  name: string;
  hourly_rate?: number | null;
  color?: string | null;
  estimated_hours?: number | null;
}

// --- Time entry types ---

export interface TimeEntry {
  id: string;
  remote_id: string | null;
  project_id: string | null;
  client_id: string | null;
  klippekort_id: string | null;
  description: string | null;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  is_billable: boolean;
  is_running: boolean;
  source: string;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  project_name: string | null;
  client_name: string | null;
  project_color: string | null;
}

export interface Project {
  id: string;
  remote_id: string | null;
  client_id: string | null;
  name: string;
  hourly_rate: number | null;
  color: string | null;
  estimated_hours: number | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
  client_name: string | null;
}

export interface OverBudgetProject {
  id: string;
  name: string;
  estimated_hours: number;
  used_hours: number;
  percentage: number;
}

// --- Recent entry type (for "continue from recent") ---

export interface RecentEntry {
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  client_id: string | null;
  client_name: string | null;
  description: string | null;
}

// --- Project suggestion (auto-prefill at manual timer start) ---

export interface ProjectSuggestion {
  project_id: string;
  project_name: string;
  /** Localization key suffix: "git_repo" | "context_path" | "app_title". */
  reason_kind: string;
  /** Concrete signal (repo name, folder label, app name) for the label. */
  reason_detail: string;
  confidence: number;
}

// --- Klippekort types ---

export interface Klippekort {
  id: string;
  remote_id: string | null;
  client_id: string;
  project_id: string | null;
  name: string;
  total_hours: number;
  used_hours: number;
  hourly_rate: number;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  client_name: string | null;
  project_name: string | null;
}

// Low-balance / near-expiry klippekort alert (dashboard warning feed).
export interface LowKlippekort {
  id: string;
  client_id: string;
  name: string;
  client_name: string | null;
  project_name: string | null;
  total_hours: number;
  used_hours: number;
  remaining_hours: number;
  hourly_rate: number;
  expires_at: string | null;
  is_low_balance: boolean;
  is_expiring_soon: boolean;
}

export interface CreateKlippekortInput {
  client_id: string;
  project_id?: string | null;
  name: string;
  total_hours: number;
  hourly_rate: number;
  expires_at?: string | null;
}

// --- Activity types (auto-tracked) ---

export interface Activity {
  id: number;
  app_name: string;
  window_title: string | null;
  url: string | null;
  git_branch: string | null;
  git_repo: string | null;
  context_path: string | null;
  file_path: string | null;
  category: string | null;
  project_id: string | null;
  /** The customer this activity is billed to, independent of the project. */
  client_id: string | null;
  confidence: number | null;
  /** Which layer classified this activity: rule | pattern | ai | inherited. */
  classification_source: string | null;
  /** Short human-readable detail of why (e.g. "git_repo timetrack-desktop"). */
  classification_reason: string | null;
  is_confirmed: boolean;
  is_idle: boolean;
  started_at: string;
  ended_at: string;
  duration: number;
}

export const ACTIVITY_CATEGORIES = [
  "development",
  "design",
  "communication",
  "meeting",
  "research",
  "writing",
  "admin",
  "personal",
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

// --- Invoice types ---

export interface InvoiceDraft {
  id: string;
  client_id: string;
  client_name: string | null;
  title: string | null;
  status: string;
  subtotal: number | null;
  vat_rate: number;
  total: number | null;
  due_date: string | null;
  notes: string | null;
  invoice_number: string | null;
  created_at: string;
  updated_at: string;
  lines: InvoiceLine[];
}

export interface InvoiceLine {
  id: number;
  invoice_id: string;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
  time_entry_id: string | null;
  sort_order: number;
}

export interface CreateLineInput {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  time_entry_id?: string | null;
  sort_order?: number | null;
}

/**
 * En redigeret fakturalinje.
 *
 * Uden `time_entry_id`, i modsætning til `CreateLineInput`: bindingen til den
 * registrerede tid hører til den række, der redigeres, og læses derfra —
 * den kan ikke flyttes ved en redigering af en pris eller en beskrivelse.
 */
export interface UpdateLineInput {
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
  sort_order?: number | null;
}

export interface UpdateInvoiceInput {
  id: string;
  title?: string | null;
  status?: string | null;
  due_date?: string | null;
  notes?: string | null;
  vat_rate?: number | null;
}

// --- Calendar event types (imported from iCal) ---

export interface CalendarEvent {
  id: number;
  source_url: string;
  uid: string;
  summary: string | null;
  start_time: string;
  end_time: string;
  location: string | null;
  imported_at: string;
}

/**
 * Payload of the `idle-return` event: the idle window the user was away for,
 * emitted by the tracker when they come back after a long break so the frontend
 * can offer the "hvad lavede du?" prompt. Timestamps are RFC3339 (UTC).
 */
export interface IdleReturnPayload {
  start: string;
  end: string;
  durationSecs: number;
}

/**
 * A calendar event not yet covered by a time entry, plus a best-guess project
 * from the classification engine. Returned by `list_uncovered_calendar_events`.
 */
export interface UncoveredCalendarEvent {
  event: CalendarEvent;
  guess_project_id: string | null;
  guess_project_name: string | null;
  guess_confidence: number | null;
  guess_client_id: string | null;
  guess_client_name: string | null;
}

// --- Database info types ---

export interface DatabaseInfo {
  file_size_bytes: number;
  client_count: number;
  project_count: number;
  time_entry_count: number;
  activity_count: number;
  klippekort_count: number;
  invoice_count: number;
  db_path: string;
}

// --- Pomodoro types ---

export interface PomodoroConfig {
  work_minutes: number;
  short_break_minutes: number;
  long_break_minutes: number;
  sessions_before_long: number;
}

/** Én kalenderdags pomodoro-tal. `day` er LOKAL dato (YYYY-MM-DD) — Rust
 *  udleder den, så browserens tidszone ikke kan flytte en pomodoro til en
 *  anden dag end den, brugeren afsluttede den på. */
export interface PomodoroDag {
  day: string;
  sessions: number;
  minutes: number;
}

/** Dagens tal plus de seneste dage. `i_dag` er altid med, også når den er
 *  nul, så UI'et aldrig skal gætte om der er data eller en fejl. */
export interface PomodoroStats {
  i_dag: PomodoroDag;
  dage: PomodoroDag[];
  minutter_i_dag: number;
}

// --- Project identity types ---
// NOTE: the Rust side serializes these with #[serde(rename_all = "camelCase")],
// unlike the older snake_case commands above.

/**
 * The signal kinds a project can be identified by.
 *
 * `app` binds a whole application (a game, a mail client). The backend refuses
 * it for apps that host many projects at once — an editor, browser or terminal —
 * since one binding there would swallow every client's time.
 */
export type MatcherKind = "git_repo" | "path" | "domain" | "keyword" | "app";

/**
 * A binding between one concrete signal and one project.
 * `projectId: null` marks the signal as deliberately NOT work (private).
 */
export interface ProjectMatcher {
  id: number;
  /** `null` is legitimate — the signal may name a customer without a project. */
  projectId: string | null;
  projectName: string | null;
  /** The billable party the signal names itself. Only both-null is "not work". */
  clientId: string | null;
  clientName: string | null;
  kind: MatcherKind;
  value: string;
}

/** A captured signal that currently resolves to no project — i.e. unattributed time. */
export interface UnmappedSignal {
  kind: MatcherKind;
  value: string;
  /** Tracked minutes carrying this signal in the scanned window. */
  minutes: number;
  activityCount: number;
  sampleApps: string[];
  /**
   * The window titles that cost the most time under this signal. Essential for
   * an `app` signal: "javaw" means nothing until you see it was "Minecraft".
   */
  sampleTitles: string[];
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  /** True when the signal looks personal (social site, or a game in the title). */
  suggestedPrivate: boolean;
}

/** How much history a matcher write (re)classified. */
export interface ApplyResult {
  classifiedActivities: number;
  classifiedMinutes: number;
}

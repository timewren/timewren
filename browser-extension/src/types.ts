// API Types
export interface User {
  id: string;
  name: string;
  email: string;
  defaultHourlyRate: number | null;
}

export interface Client {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  hourlyRate: number | null;
  timeEntryCount?: number;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  hourlyRate: number | null;
  status: "active" | "completed" | "paused";
}

export interface TimerState {
  isRunning: boolean;
  startTime: string | null;
  elapsedSeconds: number;
  baseSeconds: number;
  projectId: string | null;
  clientId: string | null;
  description: string;
  lastSyncedAt: string | null;
  lastSyncedFrom?: string | null;
  project?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
  /** Klippekort-valget gemt på serveren for timeren (#422); null = automatisk. */
  prepaidChoice?: ServerPrepaidChoice;
  /** Server-udstedt timer-session (2.6.0); null = ingen session. */
  sessionId?: string | null;
  sessionStartedAt?: string | null;
}

/**
 * Timerens klippekort-valg som serveren leverer det (getTimerState,
 * claimForStop). `clientId` er kunden valget blev truffet for.
 */
export type ServerPrepaidChoice =
  | { mode: "none"; clientId: string }
  | { mode: "package"; packageId: string; clientId: string }
  | null
  | undefined;

export interface PrepaidPackage {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  totalHours: number;
  usedHours: number;
  remainingHours: number;
  expiresAt: string | null;
  /** Købsdato (ISO) — ældste kort bruges først ved samme udløb. */
  purchasedAt?: string | null;
  isActive?: boolean; // Derived field: true if not expired and has remaining hours
  /** Kortet forvælges ved ny registrering på kunden (auto-træk). */
  autoDeduct?: boolean;
  /** Klip-afrunding i minutter; 0/null = eksakte timer. */
  clipSizeMinutes?: number | null;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  clientId: string;
  clientName: string;
  description: string;
  hours: number;
  date: string;
  createdAt: string;
  startTime: string | null;
  endTime: string | null;
  isBillable?: boolean; // Derived field: whether this entry is billable
  isFromPrepaid?: boolean; // Derived field: whether this was deducted from a prepaid package
}

export interface Organization {
  id: string;
  name: string;
  role: string;
}

// Store Types
export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  organizations: Organization[];
  selectedOrgId: string | null;
  // True once organization resolution has finished (success OR failure).
  // Data queries gate on this so they never fetch with an unresolved org and
  // briefly show another tenant's data on first load.
  orgsLoaded: boolean;
  setToken: (token: string) => Promise<void>;
  loginWithOAuth: () => Promise<void>;
  loadOrganizations: () => Promise<void>;
  setSelectedOrg: (orgId: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

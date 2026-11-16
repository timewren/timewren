/**
 * Centralized Badge Manager
 * Shows timer time (H:MM) when running, or today's total hours when idle.
 * Prevents race conditions when multiple components update the extension badge.
 */

export type BadgeType = "timer";

/**
 * Badge-farver efter docs/BRAND.md (Farver, Dark mode) og tokens.json.
 * Kørende timer = granskov, pause = amber (status), dagens timer = neutral
 * grå, fejl = rød. Teksten på badget sættes eksplicit, så den holder
 * kontrast uanset browserens eget valg.
 */
export const BADGE_COLORS = {
  running: { background: "#1E5B47", text: "#FFFFFF" }, // --tt-gran / --tt-paa-gran
  paused: { background: "#F59E0B", text: "#1A1D1C" }, // amber-500 / --tt-blaek
  today: { background: "#5F6663", text: "#FFFFFF" }, // --tt-graa
  error: { background: "#DC2626", text: "#FFFFFF" }, // red-600
} as const;

type BadgeColor = (typeof BADGE_COLORS)[keyof typeof BADGE_COLORS];

const ICONS = {
  normal: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  running: {
    16: "icons/icon-running-16.png",
    32: "icons/icon-running-32.png",
    48: "icons/icon-running-48.png",
    128: "icons/icon-running-128.png",
  },
} as const;

interface BadgeState {
  timer: { isRunning: boolean; startTime: string | null; baseSeconds: number };
  todayHours: number;
  badgeDisplay: "timer" | "today" | "off";
}

class BadgeManager {
  private state: BadgeState = {
    timer: { isRunning: false, startTime: null, baseSeconds: 0 },
    todayHours: 0,
    badgeDisplay: "timer",
  };

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  /** Ikonet der er sat nu, så setIcon kun kaldes ved skift. */
  private currentIcon: keyof typeof ICONS | null = null;

  /** Serveren har afvist denne version (CLIENT_TOO_OLD) — vinder over alt. */
  private clientTooOld = false;

  /** Indstillingen er læst fra storage (før første refresh). */
  private settingsLoaded: Promise<void> | null = null;

  /** Senest satte tekst og farve, så identiske chrome.action-kald springes over. */
  private shownText: string | null = null;
  private shownColor: BadgeColor | null = null;

  async setClientTooOld(value: boolean): Promise<void> {
    if (this.clientTooOld === value) return;
    this.clientTooOld = value;
    if (!value) await chrome.action.setTitle({ title: "TimeTrack" });
    await this.refresh();
  }

  /**
   * Update state for a specific badge type and refresh display
   */
  async update(
    _type: BadgeType,
    data: {
      isRunning?: boolean;
      startTime?: string | null;
      baseSeconds?: number;
      todayHours?: number;
    },
  ): Promise<void> {
    if (data.isRunning !== undefined) {
      this.state.timer.isRunning = data.isRunning;
    }
    if (data.startTime !== undefined) {
      this.state.timer.startTime = data.startTime;
    }
    if (data.baseSeconds !== undefined) {
      this.state.timer.baseSeconds = data.baseSeconds;
    }
    if (data.todayHours !== undefined) {
      this.state.todayHours = data.todayHours;
    }

    await this.ensureSettings();
    await this.refresh();
    this.manageRefreshInterval();
  }

  /**
   * Viser badget dagens timer med denne timer-tilstand? Kun da er det værd
   * at hente dagens registreringer.
   */
  async showsTodayHours(timer: {
    isRunning: boolean;
    baseSeconds: number;
  }): Promise<boolean> {
    await this.ensureSettings();
    const display = this.state.badgeDisplay;
    if (display === "off") return false;
    if (display === "today") return true;
    return !timer.isRunning && !(timer.baseSeconds > 0);
  }

  private ensureSettings(): Promise<void> {
    this.settingsLoaded ??= this.readSettings();
    return this.settingsLoaded;
  }

  private async readSettings(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(["extensionSettings"]);
      const settings = (result.extensionSettings ?? {}) as {
        badgeDisplay?: "timer" | "today" | "off";
      };
      this.state.badgeDisplay = settings.badgeDisplay ?? "timer";
    } catch {
      // Default to "timer" on error
      this.state.badgeDisplay = "timer";
    }
  }

  /**
   * Indstillingen er ændret (fx fra popup'en): læs den igen og vis badget.
   */
  async loadSettings(): Promise<void> {
    this.settingsLoaded = this.readSettings();
    await this.settingsLoaded;
    await this.refresh();
    this.manageRefreshInterval();
  }

  /**
   * Refresh badge display based on current state. Priority logic:
   * 1. If badgeDisplay === "off": clear badge
   * 2. If timer running AND badgeDisplay === "timer": show elapsed time (granskov)
   * 3. If timer paused AND badgeDisplay === "timer": show paused time (amber)
   * 4. If today has hours > 0: show today's total (neutral grå)
   * 5. Otherwise: clear badge
   *
   * Ikonet skifter til "timer kører"-udgaven, mens timeren kører, uanset
   * badge-indstillingen.
   */
  private async refresh(): Promise<void> {
    await this.setIcon(this.state.timer.isRunning ? "running" : "normal");

    // 0. For gammel version — vises også når badget ellers er slået fra
    if (this.clientTooOld) {
      await this.setText("!");
      await this.setBadgeColor(BADGE_COLORS.error);
      await chrome.action.setTitle({
        title: "Opdatér TimeTrack-udvidelsen",
      });
      return;
    }

    // 1. Badge disabled
    if (this.state.badgeDisplay === "off") {
      await this.setText("");
      return;
    }

    // 2. Timer running — show elapsed time
    if (this.state.timer.isRunning && this.state.badgeDisplay === "timer") {
      const elapsed = this.getElapsedSeconds();
      const text = this.formatElapsed(elapsed);
      await this.setText(text);
      await this.setBadgeColor(BADGE_COLORS.running);
      return;
    }

    // 3. Timer paused (stop nulstiller baseSeconds, så kun en pause når hertil)
    if (
      !this.state.timer.isRunning &&
      this.state.timer.baseSeconds > 0 &&
      this.state.badgeDisplay === "timer"
    ) {
      const text = this.formatElapsed(this.state.timer.baseSeconds);
      await this.setText(text);
      await this.setBadgeColor(BADGE_COLORS.paused);
      return;
    }

    // 4. Today has tracked hours: show total
    if (this.state.todayHours > 0) {
      const text = this.formatTodayHours(this.state.todayHours);
      await this.setText(text);
      await this.setBadgeColor(BADGE_COLORS.today);
      return;
    }

    // 5. Nothing to show
    await this.setText("");
  }

  private async setText(text: string): Promise<void> {
    if (this.shownText === text) return;
    await chrome.action.setBadgeText({ text });
    this.shownText = text;
  }

  private async setBadgeColor(color: BadgeColor): Promise<void> {
    if (this.shownColor === color) return;
    await chrome.action.setBadgeBackgroundColor({ color: color.background });
    // setBadgeTextColor findes fra Chrome 110 og i nyere Firefox
    if (typeof chrome.action.setBadgeTextColor === "function") {
      await chrome.action.setBadgeTextColor({ color: color.text });
    }
    this.shownColor = color;
  }

  private async setIcon(icon: keyof typeof ICONS): Promise<void> {
    if (this.currentIcon === icon) return;
    try {
      await chrome.action.setIcon({ path: { ...ICONS[icon] } });
      this.currentIcon = icon;
    } catch {
      // Ikonet er pynt; en fejl her må ikke stoppe badget
    }
  }

  /**
   * Calculate total elapsed seconds from startTime + baseSeconds
   */
  private getElapsedSeconds(): number {
    const base = this.state.timer.baseSeconds || 0;
    if (!this.state.timer.startTime) {
      return base;
    }
    const start = new Date(this.state.timer.startTime).getTime();
    const now = Date.now();
    return base + Math.max(0, (now - start) / 1000);
  }

  /**
   * Format elapsed seconds for badge: "Xm" for < 1h, "H:MM" for >= 1h
   */
  private formatElapsed(totalSeconds: number): string {
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
      return `${totalMinutes || 1}m`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }

  /**
   * Format today's total hours for badge: "X" if whole, "X.Y" otherwise, round if >= 10
   */
  private formatTodayHours(hours: number): string {
    if (hours >= 10) {
      return `${Math.round(hours)}`;
    }
    if (Number.isInteger(hours)) {
      return `${hours}`;
    }
    // One decimal place
    return hours.toFixed(1).replace(/\.0$/, "");
  }

  /**
   * Manage the auto-refresh interval for live-updating the badge while timer runs
   */
  private manageRefreshInterval(): void {
    if (this.state.timer.isRunning && this.state.badgeDisplay === "timer") {
      // Start interval if not already running — update every 30s
      if (!this.refreshInterval) {
        this.refreshInterval = setInterval(() => {
          this.refresh();
        }, 30_000);
      }
    } else {
      // Stop interval when timer is not running
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    }
  }

  /**
   * Clear all state (e.g., on logout)
   */
  async clear(): Promise<void> {
    this.state = {
      timer: { isRunning: false, startTime: null, baseSeconds: 0 },
      todayHours: 0,
      badgeDisplay: this.state.badgeDisplay,
    };
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    await this.setIcon("normal");
    if (this.clientTooOld) {
      await this.refresh();
      return;
    }
    await this.setText("");
  }
}

// Export singleton instance
export const badgeManager = new BadgeManager();

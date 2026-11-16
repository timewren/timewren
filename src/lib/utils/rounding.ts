export type RoundingMethod = "up" | "nearest" | "down";

export interface RoundingConfig {
  enabled: boolean;
  minutes: number;
  method: RoundingMethod;
}

interface RoundingFields {
  roundingEnabled: boolean | null;
  roundingMinutes: number | null;
  roundingMethod: string | null;
}

/**
 * Resolve rounding config from the hierarchy: project → client → user.
 * Returns null if no level has rounding configured.
 */
export function resolveRoundingConfig(
  user: RoundingFields,
  client: RoundingFields,
  project: RoundingFields,
): RoundingConfig | null {
  // Project overrides all
  if (project.roundingEnabled != null) {
    return {
      enabled: project.roundingEnabled,
      minutes: project.roundingMinutes ?? 15,
      method: (project.roundingMethod as RoundingMethod) ?? "up",
    };
  }

  // Client overrides user
  if (client.roundingEnabled != null) {
    return {
      enabled: client.roundingEnabled,
      minutes: client.roundingMinutes ?? 15,
      method: (client.roundingMethod as RoundingMethod) ?? "up",
    };
  }

  // User global
  if (user.roundingEnabled != null) {
    return {
      enabled: user.roundingEnabled,
      minutes: user.roundingMinutes ?? 15,
      method: (user.roundingMethod as RoundingMethod) ?? "up",
    };
  }

  return null;
}

/**
 * Round hours according to config.
 * Returns original value if config is null or disabled.
 */
export function roundHours(
  hours: number,
  config: RoundingConfig | null,
): number {
  if (!config?.enabled) return hours;

  const totalMinutes = hours * 60;
  const interval = config.minutes;

  switch (config.method) {
    case "up":
      return (Math.ceil(totalMinutes / interval) * interval) / 60;
    case "down":
      return (Math.floor(totalMinutes / interval) * interval) / 60;
    case "nearest":
      return (Math.round(totalMinutes / interval) * interval) / 60;
    default:
      return hours;
  }
}

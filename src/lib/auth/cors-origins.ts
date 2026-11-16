function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      [
        "https:",
        "http:",
        "chrome-extension:",
        "moz-extension:",
        "safari-web-extension:",
      ].includes(url.protocol) &&
      !!url.host &&
      !url.username &&
      !url.password &&
      value === `${url.protocol}//${url.host}`
    );
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string | null): origin is string {
  if (!origin || !isExactOrigin(origin)) return false;
  const configured = process.env.CORS_ALLOWED_ORIGINS;
  if (configured !== undefined) {
    return configured.split(",").some((entry) => entry.trim() === origin);
  }
  return /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(
    origin,
  );
}

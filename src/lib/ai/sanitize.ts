/**
 * Prompt Sanitization Utilities
 *
 * Prevents prompt injection attacks by sanitizing user input before
 * inserting into AI prompts.
 */

/**
 * Patterns that indicate potential prompt injection attempts
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(all\s+)?(previous|prior|above)/i,
  /new\s+instructions?:/i,
  /system\s*:\s*/i,
  /assistant\s*:\s*/i,
  /human\s*:\s*/i,
  /user\s*:\s*/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /```\s*(system|assistant|user)/i,
  /role\s*:\s*(system|assistant|user)/i,
];

/**
 * Characters that could break prompt structure
 */
const STRUCTURE_BREAKING_CHARS: Record<string, string> = {
  '"""': '"" "', // Triple quotes used as delimiters
  "'''": "'' '",
  "```": "` ` `",
  "\n\n\n": "\n\n", // Excessive newlines
};

/**
 * Sanitize user input for safe inclusion in AI prompts.
 *
 * This function:
 * 1. Detects and neutralizes prompt injection attempts
 * 2. Escapes characters that could break prompt structure
 * 3. Limits input length to prevent token abuse
 * 4. Preserves the semantic meaning of legitimate input
 *
 * @param input - The raw user input
 * @param options - Sanitization options
 * @returns Sanitized input safe for prompt inclusion
 */
export function sanitizeForPrompt(
  input: string,
  options: {
    maxLength?: number;
    allowNewlines?: boolean;
    context?: string; // For logging purposes
  } = {},
): string {
  const { maxLength = 5000, allowNewlines = true } = options;

  if (!input || typeof input !== "string") {
    return "";
  }

  let sanitized = input;

  // 1. Trim and limit length
  sanitized = sanitized.trim().slice(0, maxLength);

  // 2. Check for injection patterns and neutralize
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      // Replace the injection attempt with a neutralized version
      sanitized = sanitized.replace(pattern, "[FILTERED]");
    }
  }

  // 3. Escape structure-breaking characters
  for (const [char, replacement] of Object.entries(STRUCTURE_BREAKING_CHARS)) {
    sanitized = sanitized.split(char).join(replacement);
  }

  // 4. Handle newlines if not allowed
  if (!allowNewlines) {
    sanitized = sanitized.replace(/\n/g, " ").replace(/\s+/g, " ");
  }

  // 5. Remove any remaining control characters (except newlines/tabs)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: sanitiseringen fjerner netop kontroltegn
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  return sanitized;
}

/**
 * Sanitize an email address for prompt inclusion.
 * Only includes the domain part for privacy.
 */
export function sanitizeEmail(email: string | null | undefined): string {
  if (!email) return "ukendt";

  const parts = email.split("@");
  if (parts.length !== 2) return "ukendt";

  // Only return domain, not full email (privacy)
  return `@${sanitizeForPrompt(parts[1], { maxLength: 100, allowNewlines: false })}`;
}

/**
 * Sanitize a list of items for prompt inclusion.
 * Limits the number of items and sanitizes each one.
 */
export function sanitizeList<T>(
  items: T[],
  formatter: (item: T) => string,
  maxItems: number = 50,
): string {
  if (!items || items.length === 0) {
    return "Ingen";
  }

  const limitedItems = items.slice(0, maxItems);
  const formatted = limitedItems.map((item) => {
    const formatted = formatter(item);
    return sanitizeForPrompt(formatted, {
      maxLength: 200,
      allowNewlines: false,
    });
  });

  if (items.length > maxItems) {
    formatted.push(`... og ${items.length - maxItems} flere`);
  }

  return formatted.join("\n");
}

/**
 * Create a safe prompt by replacing placeholders with sanitized values.
 *
 * @param template - The prompt template with {placeholder} markers
 * @param values - Object mapping placeholder names to values
 * @returns The prompt with sanitized values inserted
 */
export function buildSafePrompt(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{${key}}`;
    const sanitizedValue = sanitizeForPrompt(value || "", {
      maxLength: key === "description" || key === "body" ? 2000 : 500,
      allowNewlines: key === "description" || key === "body",
    });
    result = result.replace(placeholder, sanitizedValue);
  }

  return result;
}

/**
 * Check if input appears to be a prompt injection attempt.
 * Useful for logging and monitoring.
 */
export function detectInjectionAttempt(input: string): boolean {
  if (!input) return false;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

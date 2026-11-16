import sanitizeHtml from "sanitize-html";

/**
 * Sanitize an HTML/text email body into safe plain text for task descriptions.
 *
 * 1. Strips quoted replies (blockquote, .gmail_quote, etc.)
 * 2. Strips email signatures (.gmail_signature, #signature, "-- " delimiter, etc.)
 * 3. Sanitizes remaining HTML → plain text
 * 4. Trims whitespace, limits to 5000 chars
 */
export function sanitizeEmailBodyToText(
  htmlBody: string | undefined,
  textBody: string,
): string {
  let body = "";

  if (htmlBody) {
    // Remove quoted replies and forwarded content
    let cleaned = htmlBody;

    // Gmail quoted replies
    cleaned = cleaned.replace(
      /<div[^>]*class="gmail_quote"[^>]*>[\s\S]*$/i,
      "",
    );

    // Outlook quoted replies
    cleaned = cleaned.replace(/<div[^>]*id="appendonsend"[^>]*>[\s\S]*$/i, "");
    cleaned = cleaned.replace(/<div[^>]*id="divRplyFwdMsg"[^>]*>[\s\S]*$/i, "");

    // Generic blockquotes (quoted replies)
    cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, "");

    // Gmail signatures
    cleaned = cleaned.replace(
      /<div[^>]*class="gmail_signature"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    );

    // Generic signature divs
    cleaned = cleaned.replace(
      /<div[^>]*id="signature"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    );

    // Sanitize HTML — allow only basic formatting tags
    cleaned = sanitizeHtml(cleaned, {
      allowedTags: [
        "br",
        "p",
        "div",
        "ul",
        "ol",
        "li",
        "b",
        "strong",
        "i",
        "em",
        "a",
      ],
      allowedAttributes: {},
    });

    // Convert HTML to plain text
    body = cleaned
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  } else {
    body = textBody;
  }

  // Strip email signatures (only if pattern appears after 30% of the body)
  body = stripSignature(body);

  // Clean up whitespace
  body = body
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

  // Limit length
  if (body.length > 5000) {
    body = body.slice(0, 5000);
  }

  return body;
}

/**
 * Strip common email signature patterns.
 * Only strips if the pattern appears after 30% of the body to avoid false positives.
 */
function stripSignature(text: string): string {
  const minPosition = Math.floor(text.length * 0.3);

  const signaturePatterns = [
    /^-- \s*$/m,
    /^_{3,}\s*$/m,
    /^-{3,}\s*$/m,
    /^Med venlig hilsen\b/im,
    /^Mvh\.?\s*$/im,
    /^Venlig hilsen\b/im,
    /^Vh\.?\s*$/im,
    /^Best regards\b/im,
    /^Kind regards\b/im,
    /^Warm regards\b/im,
    /^Regards\b/im,
    /^Sent from my iPhone/im,
    /^Sent from my iPad/im,
    /^Sent from my Galaxy/im,
    /^Sent from my Samsung/im,
    /^Sendt fra min iPhone/im,
    /^Sendt fra min iPad/im,
    /^Sendt fra min Samsung/im,
    /^Sendt fra min Android/im,
    /^Get Outlook for/im,
    /^Hent Outlook for/im,
    /^Von meinem iPhone gesendet/im,
    /^Envoy[ée] de mon iPhone/im,
    /^-----Original Message-----/im,
  ];

  for (const pattern of signaturePatterns) {
    const match = pattern.exec(text);
    if (match && match.index >= minPosition) {
      return text.slice(0, match.index).trim();
    }
  }

  return text;
}

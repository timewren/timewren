/**
 * Which device is the visitor on? Decided on the server from the request
 * headers, so the download pages work without client JS.
 *
 * The answer only picks the card shown first. Every platform is always listed
 * below it, so a wrong guess never locks anyone out.
 *
 * Known blind spots:
 * - iPadOS Safari sends a Mac user agent ("Macintosh") by default. Touch is the
 *   only tell, and the server cannot see it, so such an iPad gets the Mac card
 *   and the page shows an iPad shortcut under it.
 * - Apple Silicon and Intel Macs send the same user agent ("Intel Mac OS X"),
 *   so Macs get both installers.
 */
import { headers } from "next/headers";

export type DevicePlatform =
  | "ios"
  | "android"
  | "mac"
  | "windows"
  | "linux"
  | "unknown";

export interface DetectedDevice {
  platform: DevicePlatform;
  /** iPhone/iPod vs. iPad, when the user agent says so. */
  iosDevice?: "iphone" | "ipad";
}

// "(?<!cu)": the CUBOT phone brand is not a bot.
const BOT =
  /(?<!cu)bot\b|crawler|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headlesschrome|curl\/|wget\/|python-requests|go-http-client/i;

/** Sec-CH-UA-Platform is a quoted string, e.g. `"Windows"`. */
function hintPlatform(hint: string | null | undefined): DevicePlatform | null {
  const v = hint?.replace(/"/g, "").trim().toLowerCase();
  switch (v) {
    case "windows":
      return "windows";
    case "macos":
      return "mac";
    case "android":
      return "android";
    case "ios":
      return "ios";
    case "linux":
      return "linux";
    default:
      return null;
  }
}

export function detectDevice(
  userAgent: string | null | undefined,
  platformHint?: string | null,
): DetectedDevice {
  const ua = userAgent ?? "";
  if (!ua || BOT.test(ua)) return { platform: "unknown" };

  // iOS first: its user agent says "like Mac OS X".
  if (/iPad/.test(ua)) return { platform: "ios", iosDevice: "ipad" };
  if (/iPhone|iPod/.test(ua)) return { platform: "ios", iosDevice: "iphone" };

  // The client hint is more precise than the UA when the browser sends it
  // (Chromium on HTTPS), except that it never says iPad.
  const hinted = hintPlatform(platformHint);
  if (hinted) return { platform: hinted };

  if (/Android/i.test(ua)) return { platform: "android" };
  if (/Windows NT|Windows Phone|Win64|Win32/i.test(ua))
    return { platform: "windows" };
  if (/Macintosh|Mac OS X/.test(ua)) return { platform: "mac" };
  if (/CrOS/.test(ua)) return { platform: "unknown" };
  if (/Linux|X11/.test(ua)) return { platform: "linux" };
  return { platform: "unknown" };
}

/** The download options, in the order the pages list them. */
export const DOWNLOAD_TARGETS = [
  "ios",
  "android",
  "mac",
  "windows",
  "web",
] as const;
export type DownloadTarget = (typeof DOWNLOAD_TARGETS)[number];

/** The option shown as the big card. Linux and unknown get the web app. */
export function featuredTarget(device: DetectedDevice): DownloadTarget {
  const p = device.platform;
  return p === "linux" || p === "unknown" ? "web" : p;
}

/** The device behind the current request (server components only). */
export async function requestDevice(): Promise<DetectedDevice> {
  const h = await headers();
  return detectDevice(h.get("user-agent"), h.get("sec-ch-ua-platform"));
}

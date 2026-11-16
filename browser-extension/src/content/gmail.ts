/**
 * Gmail Content Script
 * Injects "Create Task" button into Gmail email view
 */

import { t } from "../i18n/core";
import { initLocale } from "../i18n/init";

interface EmailData {
  subject: string;
  sender: string;
  senderEmail: string;
  body: string;
  date: string;
  threadId: string | null;
}

// Check if we're in Gmail
function isGmail(): boolean {
  return window.location.hostname === "mail.google.com";
}

// Extract email data from the current view
function extractEmailData(): EmailData | null {
  try {
    // Get subject - Gmail uses specific classes for subject
    const subjectElement = document.querySelector<HTMLElement>(
      "h2[data-thread-perm-id], div[data-thread-id] h2, .hP",
    );
    const subject = subjectElement?.textContent?.trim() || "";

    // Get sender info - look for sender name and email
    const senderElement = document.querySelector<HTMLElement>(
      ".gD, [email], span[name]",
    );
    const sender =
      senderElement?.getAttribute("name") ||
      senderElement?.textContent?.trim() ||
      "";
    const senderEmail = senderElement?.getAttribute("email") || "";

    // Get email body - Gmail wraps body in specific divs
    const bodyElement = document.querySelector<HTMLElement>(
      ".a3s.aiL, .ii.gt, [data-message-id] .a3s",
    );
    let body = "";
    if (bodyElement) {
      // Get text content, preserving some structure
      // biome-ignore lint/performance/useDomNodeTextContent: innerText følger layout og skjuler det usynlige; textContent ville tage skjult tekst med
      body = bodyElement.innerText?.trim() || "";
      // Limit body length for task description
      if (body.length > 1000) {
        body = `${body.substring(0, 1000)}...`;
      }
    }

    // Get date
    const dateElement = document.querySelector<HTMLElement>(
      '.g3, .gH .g3, [data-tooltip][aria-label*=":"]',
    );
    const date =
      dateElement?.getAttribute("title") ||
      dateElement?.textContent?.trim() ||
      new Date().toISOString();

    // Get thread ID from URL if available
    const urlMatch = window.location.hash.match(/#[^/]+\/([^/]+)/);
    const threadId = urlMatch ? urlMatch[1] : null;

    // Only return if we have at least a subject or body
    if (!subject && !body) {
      return null;
    }

    return {
      subject,
      sender,
      senderEmail,
      body,
      date,
      threadId,
    };
  } catch (error) {
    console.error("[TimeTrack] Error extracting email data:", error);
    return null;
  }
}

// Create the TimeTrack button element
function createTaskButton(): HTMLElement {
  const button = document.createElement("div");
  button.id = "timetrack-gmail-button";
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("aria-label", t("gmail.buttonLabel"));
  button.setAttribute("data-tooltip", t("gmail.tooltip"));
  button.innerHTML = `
    <style>
      #timetrack-gmail-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        margin-left: 8px;
        background: #1e5b47; /* --tt-gran (docs/brand/tokens.json) */
        color: #ffffff;
        border-radius: 8px;
        font-family: 'Google Sans', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
      }
      #timetrack-gmail-button:hover {
        background: #164536;
      }
      #timetrack-gmail-button:active {
        background: #053728;
      }
      #timetrack-gmail-button:focus-visible {
        outline: 2px solid #1e5b47;
        outline-offset: 2px;
      }
      #timetrack-gmail-button svg {
        width: 16px;
        height: 16px;
      }
      #timetrack-gmail-button.loading {
        opacity: 0.7;
        pointer-events: none;
      }
      #timetrack-gmail-button.success {
        background: #164536;
      }
      #timetrack-gmail-button.error {
        background: #dc2626;
      }
    </style>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
    <span>${t("gmail.create")}</span>
  `;

  button.addEventListener("click", handleCreateTask);
  // role="button" på en div: Enter og mellemrum skal virke som et klik
  button.addEventListener("keydown", (event) => {
    // En holdt tast må ikke oprette flere opgaver
    if (event.repeat) return;
    if (event.key === "Enter" || event.key === " ") {
      void handleCreateTask(event);
    }
  });

  return button;
}

// Handle task creation
async function handleCreateTask(event: Event): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  const button = document.getElementById("timetrack-gmail-button");
  if (!button || button.classList.contains("loading")) return;

  const emailData = extractEmailData();
  if (!emailData) {
    showNotification(t("gmail.readFailed"), "error");
    return;
  }

  // Set loading state
  button.classList.add("loading");
  const span = button.querySelector("span");
  const originalText = span?.textContent || "";
  if (span) span.textContent = t("gmail.creating");

  try {
    // Send message to background script
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_TASK_FROM_EMAIL",
      data: emailData,
    });

    if (response?.success) {
      button.classList.add("success");
      if (span) span.textContent = t("gmail.created");
      showNotification(t("gmail.createdFromMail"), "success");

      // Reset after 2 seconds
      setTimeout(() => {
        button.classList.remove("success");
        if (span) span.textContent = originalText;
      }, 2000);
    } else {
      throw new Error(response?.error || t("errors.unknown"));
    }
  } catch (error) {
    console.error("[TimeTrack] Error creating task:", error);
    button.classList.add("error");
    if (span) span.textContent = t("gmail.error");
    showNotification(
      error instanceof Error ? error.message : t("errors.task.createFailed"),
      "error",
    );

    // Reset after 2 seconds
    setTimeout(() => {
      button.classList.remove("error");
      if (span) span.textContent = originalText;
    }, 2000);
  } finally {
    button.classList.remove("loading");
  }
}

// Inject notification styles once
let notificationStylesInjected = false;
function ensureNotificationStyles(): void {
  if (notificationStylesInjected) return;
  notificationStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    #timetrack-notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: 'Google Sans', Roboto, sans-serif;
      font-size: 14px;
      color: white;
      z-index: 10000;
      animation: ttSlideIn 0.3s ease;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    #timetrack-notification.success { background: #1e5b47; }
    #timetrack-notification.error { background: #dc2626; }
    @keyframes ttSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      #timetrack-notification { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

// Show a toast notification
function showNotification(message: string, type: "success" | "error"): void {
  ensureNotificationStyles();

  // Remove existing notification
  const existing = document.getElementById("timetrack-notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.id = "timetrack-notification";
  notification.classList.add(type);
  // Skærmlæsere skal høre resultatet: fejl afbryder, succes venter
  notification.setAttribute("role", type === "error" ? "alert" : "status");

  // Use textContent to prevent XSS from server error messages
  const span = document.createElement("span");
  span.textContent = message;
  notification.appendChild(span);

  document.body.appendChild(notification);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = "ttSlideIn 0.3s ease reverse";
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Find the best toolbar location to inject button
function findToolbar(): HTMLElement | null {
  // Gmail toolbar selectors (try multiple as Gmail UI varies)
  const selectors = [
    // Email view toolbar (actions row)
    ".G-Ni.J-J5-Ji", // Action icons row
    ".iH > div", // Header actions
    ".nH.bkK .iH", // Top header in email view
    // Thread view toolbar
    ".G-atb.D.E", // Thread actions bar
    ".G-tF", // Gmail toolbar container
    // Alternative selectors
    '[gh="mtb"]', // Message toolbar
    ".ade", // Action bar
  ];

  for (const selector of selectors) {
    const toolbar = document.querySelector<HTMLElement>(selector);
    if (toolbar) {
      return toolbar;
    }
  }

  return null;
}

// Check if we're viewing an email (not inbox list)
function isViewingEmail(): boolean {
  // Check URL hash for thread view pattern
  const hash = window.location.hash;
  // Gmail uses patterns like #inbox/FMfcgz... or #sent/FMfcgz... etc.
  const isThreadView = /^#[^/]+\/[A-Za-z0-9]+/.test(hash);

  // Also check for open email DOM elements
  const hasEmailView =
    document.querySelector(".nH.bkK, .adn, [data-message-id]") !== null;

  return isThreadView || hasEmailView;
}

// Inject or update the button
function injectButton(): void {
  // Only inject if we're viewing an email
  if (!isViewingEmail()) {
    removeButton();
    return;
  }

  // Don't inject if button already exists
  if (document.getElementById("timetrack-gmail-button")) {
    return;
  }

  const toolbar = findToolbar();
  if (!toolbar) {
    // Gmail might not be fully loaded, retry
    return;
  }

  const button = createTaskButton();
  toolbar.appendChild(button);
}

// Remove the button
function removeButton(): void {
  const button = document.getElementById("timetrack-gmail-button");
  if (button) {
    button.remove();
  }
}

const OBSERVER_THROTTLE_MS = 1000;

// Track observer to prevent double-init and allow cleanup
let gmailObserver: MutationObserver | null = null;

// Initialize Gmail integration
function init(): void {
  if (!isGmail() || gmailObserver) {
    return;
  }

  console.log("[TimeTrack] Gmail integration initialized");

  // Initial injection attempt
  injectButton();

  // Watch for navigation changes (Gmail is a SPA)
  let lastHash = window.location.hash;

  // MutationObserver på hele body fyrer konstant i Gmail. Højst ét tjek pr.
  // sekund, intet mens fanen er skjult, og intet når knappen allerede står.
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  gmailObserver = new MutationObserver(() => {
    if (throttleTimer || document.hidden) return;
    if (
      window.location.hash === lastHash &&
      document.getElementById("timetrack-gmail-button")
    ) {
      return;
    }
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      // Check if hash changed (navigation)
      if (window.location.hash !== lastHash) {
        lastHash = window.location.hash;
        // Delay to let Gmail render the new view
        setTimeout(injectButton, 500);
      } else {
        // Check if we need to inject (Gmail dynamic loading)
        if (
          isViewingEmail() &&
          !document.getElementById("timetrack-gmail-button")
        ) {
          injectButton();
        }
      }
    }, OBSERVER_THROTTLE_MS);
  });

  // Observe the main Gmail container
  const gmailContainer = document.querySelector("body");
  if (gmailContainer) {
    gmailObserver.observe(gmailContainer, {
      childList: true,
      subtree: true,
    });
  }

  // Also listen for hashchange events
  window.addEventListener("hashchange", () => {
    setTimeout(injectButton, 500);
  });
}

// Start when DOM is ready (efter at sprogvalget er læst)
void initLocale().finally(() => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
});

// Export for testing
export { extractEmailData, isGmail, isViewingEmail };

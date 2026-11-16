# Email-to-Task Feature - Technical Specification

## 📋 Executive Summary

**Feature Name:** Email-to-Task Automation
**Version:** 1.0
**Priority:** High - Competitive Differentiator
**Estimated Effort:** 4-6 weeks full implementation
**Dependencies:** OpenAI API, IMAP access, Existing tasks system

### Product Vision

Automatically convert customer emails into actionable tasks with AI-powered parsing, customer matching, and intelligent project assignment. Reduce manual task creation by 80% and provide full email context for every customer request.

### Inspiration

Billy.dk's automatic receipt/invoice extraction via IMAP - but for customer tasks instead of financial documents.

## 🎯 Business Value

### Key Benefits

1. **Time Savings:** Eliminate manual email-to-task copying (estimated 30-60 min/day)
2. **Context Preservation:** Full email thread history linked to tasks
3. **Competitive Edge:** Unique feature vs Effihub and traditional CRMs
4. **Customer Matching:** AI automatically links emails to correct customers
5. **Proactive Updates:** Tasks automatically update when customers reply

### Success Metrics

- 80% reduction in manual task creation time
- 95%+ accuracy in customer matching (AI confidence > 0.85)
- 90% user adoption within 30 days of launch
- Average time-to-task < 5 minutes from email receipt

## 🏗️ System Architecture

### Overview

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Email Server │─────▶│ Background   │─────▶│ AI Parser    │
│   (IMAP)     │      │ Sync Worker  │      │  (OpenAI)    │
└──────────────┘      └──────────────┘      └──────────────┘
                             │                       │
                             │                       │
                             ▼                       ▼
                      ┌──────────────┐      ┌──────────────┐
                      │  Database    │◀─────│  Customer    │
                      │  (Postgres)  │      │  Matcher     │
                      └──────────────┘      └──────────────┘
                             │
                             │
                             ▼
                      ┌──────────────┐
                      │   Web UI     │
                      │   (Next.js)  │
                      └──────────────┘
```

### Technology Stack

- **IMAP Client:** `node-imap` or `imapflow` (better TypeScript support)
- **Email Parsing:** `mailparser` (parse MIME messages)
- **AI Processing:** OpenAI GPT-4o-mini (fast + cheap) or user's own API key
- **Encryption:** AES-256-GCM (Node `crypto`) for credential storage. (No Argon2 here; it's a password hasher, not encryption.)
- **Background Jobs:** Native Node.js setInterval or `node-cron`
- **Queue System:** PostgreSQL-backed job queue (simple, no Redis needed)

## 📊 Database Schema Extensions

### New Tables

#### 1. `email_integrations`

Store IMAP credentials and sync status per user.

```typescript
export const emailIntegrations = pgTable("email_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(), // One email integration per user for MVP

  // IMAP Configuration
  imapHost: varchar("imap_host", { length: 255 }).notNull(), // e.g., "imap.gmail.com"
  imapPort: integer("imap_port").notNull().default(993), // Standard IMAP SSL port
  imapUsername: varchar("imap_username", { length: 255 }).notNull(), // Usually email address
  imapPassword: text("imap_password").notNull(), // Encrypted with AES-256
  imapUseSSL: boolean("imap_use_ssl").default(true).notNull(),

  // Sync Settings
  syncEnabled: boolean("sync_enabled").default(true).notNull(),
  syncFrequencyMinutes: integer("sync_frequency_minutes").default(15).notNull(), // Every 15 minutes
  lastSyncedAt: timestamp("last_synced_at"),
  lastSyncStatus: varchar("last_sync_status", { length: 20 }), // 'success', 'error', 'partial'
  lastSyncError: text("last_sync_error"),

  // Mailbox settings
  targetMailbox: varchar("target_mailbox", { length: 100 })
    .default("INBOX")
    .notNull(),
  processedEmailsCount: integer("processed_emails_count").default(0).notNull(),

  // Error handling
  consecutiveSyncFailures: integer("consecutive_sync_failures")
    .default(0)
    .notNull(),
  syncDisabledUntil: timestamp("sync_disabled_until"), // For exponential backoff

  // Filters (future enhancement)
  senderWhitelist: text("sender_whitelist").array(), // Only process emails from these domains
  senderBlacklist: text("sender_blacklist").array(), // Never process emails from these
  subjectFilters: text("subject_filters").array(), // Regex patterns for subject filtering

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

#### 2. `email_threads`

Track email conversations and their relationship to tasks.

```typescript
export const emailThreads = pgTable("email_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  taskId: uuid("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),

  // Email Thread Identification
  messageId: varchar("message_id", { length: 255 }).notNull(), // RFC 822 Message-ID
  threadId: varchar("thread_id", { length: 255 }), // Gmail-style thread ID or In-Reply-To chain
  inReplyTo: varchar("in_reply_to", { length: 255 }), // Parent message ID
  references: text("references").array(), // All related message IDs in thread

  // Email Metadata
  subject: text("subject").notNull(),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  toEmails: text("to_emails").array().notNull(),
  ccEmails: text("cc_emails").array(),
  receivedDate: timestamp("received_date").notNull(),

  // Content
  bodyText: text("body_text"), // Plain text version
  bodyHtml: text("body_html"), // HTML version (for display)

  // Attachments (stored as JSON array)
  attachments:
    jsonb("attachments").$type<
      {
        filename: string;
        contentType: string;
        size: number;
        storagePath?: string; // Future: store attachments in S3/local storage
      }[]
    >(),

  // Processing Status
  isProcessed: boolean("is_processed").default(false).notNull(),
  processingError: text("processing_error"),

  // Customer Matching
  matchedClientId: uuid("matched_client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  matchConfidence: decimal("match_confidence", { precision: 3, scale: 2 }), // 0.00 to 1.00

  // Thread Status
  isRead: boolean("is_read").default(false),
  isFlagged: boolean("is_flagged").default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Index for fast thread lookup
// CREATE UNIQUE INDEX email_threads_user_message_id_idx ON email_threads(user_id, message_id);
// CREATE INDEX email_threads_message_id_idx ON email_threads(message_id);
// CREATE INDEX email_threads_thread_id_idx ON email_threads(thread_id);
// CREATE INDEX email_threads_task_id_idx ON email_threads(task_id);
```

#### 3. `email_sync_queue`

PostgreSQL-backed job queue for email processing.

```typescript
export const emailSyncQueue = pgTable("email_sync_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Job Details
  jobType: varchar("job_type", { length: 50 }).notNull(), // 'initial_sync', 'incremental_sync', 'process_email'
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending', 'processing', 'completed', 'failed'

  // Job Data
  payload: jsonb("payload").notNull(), // Job-specific data (email IDs, sync params, etc.)

  // Execution
  priority: integer("priority").default(5).notNull(), // 1 (highest) to 10 (lowest)
  attemptCount: integer("attempt_count").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),

  // Timing
  scheduledFor: timestamp("scheduled_for").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),

  // Error Handling
  errorMessage: text("error_message"),
  errorStack: text("error_stack"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// CREATE INDEX email_sync_queue_status_priority_idx ON email_sync_queue(status, priority, scheduled_for);
```

### Schema Modifications to Existing Tables

#### `users` table (already has some fields)

```typescript
// ALREADY EXISTS (line 62-75 in schema.ts):
inboundEmailId: varchar("inbound_email_id", { length: 32 }).unique(),
aiAutonomyLevel: varchar("ai_autonomy_level", { length: 20 }).default("auto_all"),
aiEmailProcessing: boolean("ai_email_processing").default(true),
aiProvider: varchar("ai_provider", { length: 20 }).default("system"),
aiApiKey: text("ai_api_key"),
aiApiUrl: varchar("ai_api_url", { length: 500 }),
aiModel: varchar("ai_model", { length: 100 }),
```

**NO CHANGES NEEDED** - Already has all required fields for email-to-task!

#### `tasks` table (already has comprehensive fields)

```typescript
// ALREADY EXISTS (line 449-503 in schema.ts):
sourceType: varchar("source_type", { length: 20 }).default("manual"), // 'manual', 'email', 'calendar', 'extension'
sourceId: varchar("source_id", { length: 255 }), // External ID (email ID, calendar event ID, etc.)
sourceUrl: text("source_url"),

aiSuggestedProject: uuid("ai_suggested_project"),
aiSuggestedClient: uuid("ai_suggested_client"),
aiSuggestedPriority: varchar("ai_suggested_priority", { length: 20 }),
aiSuggestedDeadline: timestamp("ai_suggested_deadline"),
aiConfidence: decimal("ai_confidence", { precision: 3, scale: 2 }),
aiProcessedAt: timestamp("ai_processed_at"),
```

**NO CHANGES NEEDED** - Already perfect for email-to-task integration!

### Relations

```typescript
export const emailIntegrationsRelations = relations(
  emailIntegrations,
  ({ one }) => ({
    user: one(users, {
      fields: [emailIntegrations.userId],
      references: [users.id],
    }),
  }),
);

export const emailThreadsRelations = relations(emailThreads, ({ one }) => ({
  user: one(users, {
    fields: [emailThreads.userId],
    references: [users.id],
  }),
  task: one(tasks, {
    fields: [emailThreads.taskId],
    references: [tasks.id],
  }),
  matchedClient: one(clients, {
    fields: [emailThreads.matchedClientId],
    references: [clients.id],
  }),
}));

export const emailSyncQueueRelations = relations(emailSyncQueue, ({ one }) => ({
  user: one(users, {
    fields: [emailSyncQueue.userId],
    references: [users.id],
  }),
}));
```

## 🔧 Core Components Implementation

### Environment Variables

```env
# Email-to-Task
EMAIL_ENCRYPTION_KEY="" # 32-byte key used for AES-256-GCM credential encryption
EMAIL_SYNC_STORE_ATTACHMENTS="false" # "true" uploads IMAP attachment files to private S3; default keeps metadata only (filename, size, type)
```

### 1. IMAP Client Service

**File:** `src/lib/services/imap-client.ts`

**Key Features:**
- Secure connection to IMAP servers (SSL/TLS)
- Fetch new emails since last sync
- Parse email headers and body
- Handle IDLE for real-time updates (future enhancement)
- Exponential backoff on errors

**Implementation Outline:**
```typescript
import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import { decryptCredentials } from "@/lib/crypto";

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

interface EmailMessage {
  messageId: string;
  threadId?: string;
  inReplyTo?: string;
  references: string[];
  subject: string;
  from: { email: string; name?: string };
  to: string[];
  cc: string[];
  receivedDate: Date;
  bodyText: string;
  bodyHtml: string;
  attachments: {
    filename: string;
    contentType: string;
    size: number;
    content?: Buffer;
  }[];
}

export class ImapClientService {
  private config: ImapConfig;
  private imap: Imap | null = null;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Initialize IMAP connection with config
    // Handle authentication errors
    // Implement connection timeout
  }

  async disconnect(): Promise<void> {
    // Safely close IMAP connection
  }

  async fetchNewEmails(sinceDate: Date): Promise<EmailMessage[]> {
    // Search for emails since last sync
    // Fetch email headers and body
    // Parse with mailparser
    // Return structured EmailMessage array
  }

  async markAsRead(messageId: string): Promise<void> {
    // Mark email as read in IMAP server (optional)
  }

  private async parseEmail(stream: NodeJS.ReadableStream): Promise<ParsedMail> {
    // Use mailparser to parse MIME message
    return simpleParser(stream);
  }
}
```

### 2. AI Email Parser

**File:** `src/lib/services/ai-email-parser.ts`

**Responsibilities:**
- Extract task title, description, priority from email content
- Identify deadline/due date mentions
- Estimate time required (AI-powered)
- Extract action items from email body
- Detect urgency/priority signals

**AI Prompt Design:**
```typescript
const TASK_EXTRACTION_PROMPT = `
You are an AI assistant helping a freelancer extract actionable tasks from customer emails.

Email Details:
Subject: {subject}
From: {fromName} <{fromEmail}>
Body: {bodyText}

Please analyze this email and extract the following information:

1. Task Title: A clear, concise title (max 100 characters)
2. Description: A detailed description of what needs to be done
3. Priority: One of: low, medium, high, urgent
4. Estimated Time: Estimated time in minutes to complete this task
5. Deadline: Any mentioned deadline (ISO date format) or null
6. Action Items: List of specific action items mentioned

Respond in JSON format:
{
  "taskTitle": "...",
  "description": "...",
  "priority": "medium",
  "estimatedMinutes": 60,
  "deadline": "2026-02-01T00:00:00Z" or null,
  "actionItems": ["..."],
  "confidence": 0.85
}

If this email does not contain any actionable task (e.g., just a "thank you" email), set confidence to 0.0.
`;
```

**Implementation:**
```typescript
interface TaskExtractionResult {
  taskTitle: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  estimatedMinutes: number | null;
  deadline: Date | null;
  actionItems: string[];
  confidence: number; // 0.0 to 1.0
}

export class AIEmailParser {
  private openaiApiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = "gpt-4o-mini") {
    this.openaiApiKey = apiKey;
    this.model = model;
  }

  async extractTask(email: EmailMessage): Promise<TaskExtractionResult> {
    // Build prompt with email details
    // Call OpenAI API
    // Parse JSON response
    // Validate and sanitize output
    // Log to aiProcessingLogs table
  }

  async summarizeThread(emails: EmailMessage[]): Promise<string> {
    // Summarize entire email thread for context
    // Useful for long conversations
  }
}
```

### 3. Customer Matcher

**File:** `src/lib/services/customer-matcher.ts`

**Strategy:**
1. **Exact Match:** Email domain matches client email domain
2. **Company Match:** Email domain matches client company CVR domain
3. **Name Similarity:** Sender name matches client name (fuzzy matching)
4. **AI-Powered:** Use OpenAI to match based on email content + client database

**Implementation:**
```typescript
interface CustomerMatchResult {
  clientId: string | null;
  confidence: number; // 0.0 to 1.0
  matchReason: string;
}

export class CustomerMatcher {
  async matchCustomer(
    email: EmailMessage,
    userId: string,
  ): Promise<CustomerMatchResult> {
    // 1. Try exact email domain match
    const exactMatch = await this.exactEmailMatch(email.from.email, userId);
    if (exactMatch) {
      return {
        clientId: exactMatch.id,
        confidence: 1.0,
        matchReason: "exact_email",
      };
    }

    // 2. Try company domain match (CVR lookup)
    const companyMatch = await this.companyDomainMatch(
      email.from.email,
      userId,
    );
    if (companyMatch) {
      return {
        clientId: companyMatch.id,
        confidence: 0.95,
        matchReason: "company_domain",
      };
    }

    // 3. Fuzzy name matching
    const nameMatch = await this.fuzzyNameMatch(email.from.name, userId);
    if (nameMatch && nameMatch.confidence > 0.8) {
      return {
        clientId: nameMatch.id,
        confidence: nameMatch.confidence,
        matchReason: "name_similarity",
      };
    }

    // 4. AI-powered matching (use email content + client context)
    const aiMatch = await this.aiPoweredMatch(email, userId);
    if (aiMatch && aiMatch.confidence > 0.7) {
      return {
        clientId: aiMatch.id,
        confidence: aiMatch.confidence,
        matchReason: "ai_match",
      };
    }

    // No match found
    return { clientId: null, confidence: 0.0, matchReason: "no_match" };
  }

  private async exactEmailMatch(email: string, userId: string) {
    // Query clients table for exact email match
  }

  private async companyDomainMatch(email: string, userId: string) {
    // Extract domain from email
    // Query clients table for matching domain in company field
  }

  private async fuzzyNameMatch(name: string, userId: string) {
    // Use Levenshtein distance or similar algorithm
    // Query clients table for similar names
  }

  private async aiPoweredMatch(email: EmailMessage, userId: string) {
    // Build prompt with email details and list of clients
    // Ask OpenAI to match customer
    // Return best match with confidence score
  }
}
```

### 4. Email Sync Worker

**File:** `src/lib/workers/email-sync-worker.ts`

**Responsibilities:**
- Run background sync every N minutes (configurable)
- Process sync queue jobs
- Handle errors and retries with exponential backoff
- Update sync status in database

**Implementation (cron endpoint):**
Use the existing cron infrastructure (see `CLAUDE.md`) and expose a handler like:
```typescript
// /api/cron/email-sync
export async function GET() {
  // 1. Get all active email integrations
  // 2. For each integration, fetch new emails
  // 3. For each email:
  //    - Parse with AI
  //    - Match customer
  //    - Create task
  //    - Store email thread
  // 4. Update lastSyncedAt timestamp
  // 5. Handle errors with exponential backoff
}
```

### 5. Thread Updater

**File:** `src/lib/services/thread-updater.ts`

**Responsibilities:**
- Detect email replies to existing threads
- Update task status based on email content
- Add new comments/notes to task when customer replies
- Notify user of updates

**Implementation:**
```typescript
export class ThreadUpdater {
  async handleIncomingEmail(email: EmailMessage, userId: string) {
    // 1. Check if this is a reply (has inReplyTo or references)
    if (!email.inReplyTo && email.references.length === 0) {
      // New thread, create new task
      return this.createNewTask(email, userId);
    }

    // 2. Find existing thread by message ID or references
    const existingThread = await this.findExistingThread(email);

    if (existingThread) {
      // 3. Update existing task with new information
      await this.updateExistingTask(existingThread.taskId, email);

      // 4. Add new email to thread
      await this.addEmailToThread(existingThread.id, email);

      // 5. Notify user (optional)
      await this.notifyUser(userId, existingThread.taskId, "new_reply");
    } else {
      // Thread not found, create new task
      return this.createNewTask(email, userId);
    }
  }

  private async findExistingThread(email: EmailMessage) {
    // Query email_threads table
    // Look for matching messageId in references array
    // Or matching threadId
  }

  private async updateExistingTask(taskId: string, email: EmailMessage) {
    // Optionally use AI to determine if status should change
    // E.g., "this is done" -> mark task as completed
    // Add new description/notes from email
  }
}
```

## 🎨 User Interface Components

### 1. Email Integration Setup Page

**Route:** `/dashboard/settings/email-integration`

**Components:**
- `EmailIntegrationForm.tsx` - IMAP credentials input
- `ConnectionTester.tsx` - Test IMAP connection before saving
- `SyncStatusDisplay.tsx` - Show last sync status and stats

**Features:**
- Secure password input (masked)
- Pre-filled common IMAP configurations (Gmail, Outlook, custom)
- Test connection button
- Sync frequency selector (5, 15, 30, 60 minutes)
- Enable/disable toggle

**UI Mockup:**
```
┌────────────────────────────────────────────────────────────┐
│  Email Integration                                         │
│                                                             │
│  Connect your email to automatically create tasks from     │
│  customer emails.                                           │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ IMAP Configuration                                    │ │
│  │                                                        │ │
│  │ Email Provider:  [Gmail ▼]                            │ │
│  │                                                        │ │
│  │ IMAP Host:       imap.gmail.com                       │ │
│  │ IMAP Port:       993                                   │ │
│  │ Username:        [your.email@gmail.com]               │ │
│  │ Password:        [••••••••••••••••]                   │ │
│  │                                                        │ │
│  │ [Test Connection]  [Save Configuration]               │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Sync Settings                                         │ │
│  │                                                        │ │
│  │ Sync Frequency:  [Every 15 minutes ▼]                │ │
│  │ Sync Enabled:    [✓] Automatically sync emails       │ │
│  │                                                        │ │
│  │ Last Sync:       2 minutes ago (Success)             │ │
│  │ Processed:       23 emails → 18 tasks created        │ │
│  └──────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

### 2. Task Detail with Email Thread

**Component:** `TaskDetailWithEmail.tsx`

**Features:**
- Show email thread history for tasks created from email
- Display sender info and matched customer
- Show AI confidence score for customer matching
- Allow manual customer reassignment if AI got it wrong
- Link to full email conversation

**UI Mockup:**
```
┌────────────────────────────────────────────────────────────┐
│  Task: Fix login bug on production website                │
│                                                             │
│  📧 Created from email • From: john@example.com           │
│  👤 Customer: Acme Corp (AI Match: 95% confidence)        │
│  📁 Project: Website Maintenance                           │
│  ⏱️ Estimated: 2 hours                                     │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Email Thread                                          │ │
│  │                                                        │ │
│  │ ✉️ Jan 10, 2026 - John Smith (john@example.com)      │ │
│  │                                                        │ │
│  │ Hi, we're experiencing issues with login on the       │ │
│  │ website. Users can't log in after the recent update. │ │
│  │ This is urgent - please fix ASAP!                     │ │
│  │                                                        │ │
│  │ [Reply] [Mark as Done]                                │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                             │
│  [Start Timer] [Edit Task] [Complete]                      │
└────────────────────────────────────────────────────────────┘
```

### 3. Email Tasks Dashboard Widget

**Component:** `EmailTasksWidget.tsx`

**Features:**
- Show recent tasks created from emails
- Display unprocessed emails count
- Quick actions to process/review new email tasks
- Filter by AI confidence (show low-confidence matches for review)

### 4. Customer Match Review Panel

**Component:** `CustomerMatchReview.tsx`

**Features:**
- List tasks with low AI confidence (<0.7)
- Allow manual customer assignment
- Train AI by confirming or correcting matches
- Bulk actions for multiple tasks

## 🔐 Security & Privacy

### Credential Storage

- **Encryption:** All IMAP passwords encrypted using AES-256-GCM
- **Key Management:** Encryption key stored in environment variable (not in database)
- **At Rest:** Credentials encrypted in PostgreSQL
- **In Transit:** Always use SSL/TLS for IMAP connections

**Encryption Implementation:**
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY!; // 32-byte key
const ALGORITHM = "aes-256-gcm";

export function encryptPassword(password: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );

  let encrypted = cipher.update(password, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Return iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decryptPassword(encryptedData: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, "hex"),
    Buffer.from(ivHex, "hex"),
  );

  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
```

### GDPR Compliance

- **Data Minimization:** Only store email metadata and body text, not raw MIME
- **Right to Deletion:** When user deletes account, purge all email data
- **Data Portability:** Export email tasks as JSON/CSV
- **Consent:** Explicit opt-in for email integration feature
- **Transparency:** Show what data is stored and how it's used

### Rate Limiting

- **IMAP Connections:** Max 1 concurrent connection per user
- **API Calls:** Max 10 OpenAI requests per sync job
- **Sync Frequency:** Configurable minimum 5 minutes between syncs

## 📡 API Endpoints (tRPC)

### Email Integration Routes

```typescript
// src/lib/trpc/routers/email-integration.ts

export const emailIntegrationRouter = router({
  // Get current integration settings
  getIntegration: protectedProcedure.query(async ({ ctx }) => {
    // Return user's email integration config (password masked)
  }),

  // Create or update IMAP configuration
  upsertIntegration: protectedProcedure
    .input(
      z.object({
        imapHost: z.string(),
        imapPort: z.number(),
        imapUsername: z.string(),
        imapPassword: z.string(),
        imapUseSSL: z.boolean(),
        syncFrequencyMinutes: z.number().min(5).max(60),
        syncEnabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Encrypt password
      // Save to emailIntegrations table
      // Trigger initial sync job
    }),

  // Test IMAP connection
  testConnection: protectedProcedure
    .input(
      z.object({
        imapHost: z.string(),
        imapPort: z.number(),
        imapUsername: z.string(),
        imapPassword: z.string(),
        imapUseSSL: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Try connecting to IMAP server
      // Return success/error status
    }),

  // Manually trigger sync
  triggerSync: protectedProcedure.mutation(async ({ ctx }) => {
    // Add sync job to queue
    // Return job ID for status tracking
  }),

  // Get sync history/status
  getSyncHistory: protectedProcedure.query(async ({ ctx }) => {
    // Return last 10 sync operations with status
  }),

  // Delete integration
  deleteIntegration: protectedProcedure.mutation(async ({ ctx }) => {
    // Delete email integration
    // Optionally: delete all email threads and related tasks
  }),
});
```

### Email Tasks Routes

```typescript
// src/lib/trpc/routers/email-tasks.ts

export const emailTasksRouter = router({
  // Get tasks created from emails
  getEmailTasks: protectedProcedure
    .input(
      z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
        minConfidence: z.number().optional(), // Filter by AI confidence
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query tasks where sourceType = 'email'
      // Include email thread data
      // Filter by confidence if specified
    }),

  // Get email thread for a task
  getThreadForTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Get all emails in thread for this task
      // Return chronologically sorted
    }),

  // Update customer match (manual correction)
  updateCustomerMatch: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        clientId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Update task clientId
      // Update email thread matchedClientId
      // Log correction for AI learning
    }),

  // Get tasks needing review (low confidence)
  getTasksNeedingReview: protectedProcedure.query(async ({ ctx }) => {
    // Get tasks with aiConfidence < 0.7
    // Or tasks without matched customer
  }),
});
```

## 🧪 Testing Strategy

### Unit Tests

- `imap-client.test.ts` - Test IMAP connection, email fetching, parsing
- `ai-email-parser.test.ts` - Test AI extraction with mock OpenAI responses
- `customer-matcher.test.ts` - Test exact/fuzzy/AI matching logic
- `crypto.test.ts` - Test password encryption/decryption

### Integration Tests

- `email-sync-flow.test.ts` - End-to-end sync workflow
- `thread-tracking.test.ts` - Test email thread detection and updates
- `task-creation.test.ts` - Test task creation from email with all fields

### Mock Data

- Sample IMAP email responses (real Gmail/Outlook format)
- Mock OpenAI API responses for parsing
- Test users with known email integrations

## 📈 Performance Considerations

### Optimization Strategies

1. **Batch Processing:** Process multiple emails per sync job (max 50)
2. **Parallel Processing:** Use Promise.all for independent operations
3. **Pagination:** Fetch emails in pages (100 at a time)
4. **Incremental Sync:** Only fetch emails since last sync timestamp
5. **Database Indexes:** Index email_threads by messageId, threadId, taskId
6. **Caching:** Cache customer match results for 24 hours

### Scalability

- **Current Target:** 500 users, each receiving ~20 emails/day = 10,000 emails/day
- **Processing Time:** ~5 seconds per email (AI parsing + DB operations)
- **Total Daily Processing:** ~14 hours of processing time
- **Solution:** Run background worker on separate process/container

### Error Recovery

- **Exponential Backoff:** On IMAP errors, wait 1min → 2min → 5min → 15min → disable
- **Partial Sync:** If sync fails midway, resume from last processed email
- **Dead Letter Queue:** Move repeatedly failing emails to manual review queue

## 🚀 Implementation Phases

### Phase 1: Foundation (Week 1-2)

- [ ] Database schema migrations (email_integrations, email_threads, email_sync_queue)
- [ ] IMAP client service implementation
- [ ] Email parsing with mailparser
- [ ] Basic UI for IMAP configuration
- [ ] Password encryption utilities

**Deliverables:**
- Users can add IMAP credentials
- Test connection works
- Emails can be fetched and parsed

### Phase 2: AI & Matching (Week 3-4)

- [ ] OpenAI integration for task extraction
- [ ] AI prompt engineering and testing
- [ ] Customer matching algorithms (exact, fuzzy, AI)
- [ ] AI processing logs integration
- [ ] Task creation from email flow

**Deliverables:**
- Emails automatically parsed into task fields
- Customers matched with >85% accuracy
- Tasks created with correct data

### Phase 3: Threading & Updates (Week 5)

- [ ] Email thread detection (In-Reply-To, References)
- [ ] Thread updater service
- [ ] Task update on email reply
- [ ] UI for viewing email threads on tasks
- [ ] Customer match review panel

**Deliverables:**
- Email replies update existing tasks
- Thread history visible in task details
- Low-confidence matches can be reviewed

### Phase 4: Background Sync & Polish (Week 6)

- [ ] Background sync worker implementation
- [ ] Queue-based job processing
- [ ] Error handling and retry logic
- [ ] Sync status dashboard
- [ ] Performance optimization
- [ ] User documentation

**Deliverables:**
- Automatic background sync every 15 minutes
- Robust error handling
- User-friendly sync status display
- Complete documentation

### Future Enhancements (Post-MVP)

- [ ] Gmail/Microsoft OAuth (easier auth, no IMAP passwords)
- [ ] IMAP IDLE for real-time push notifications
- [ ] Attachment storage and viewing
- [ ] Email reply from task interface (two-way sync)
- [ ] Smart filters (only process emails from specific senders)
- [ ] Learning from user corrections (improve AI matching)
- [ ] Slack/Discord integration for task notifications
- [ ] Mobile app support

## 📚 User Documentation

### Setup Guide: "Connect Your Email to Auto-Create Tasks"

**Step 1: Enable IMAP in Your Email Provider**

**Gmail:**
1. Go to Gmail Settings → Forwarding and POP/IMAP
2. Enable IMAP access
3. Create an App Password (if 2FA enabled):
   - Google Account → Security → 2-Step Verification → App passwords
   - Generate password for "Mail" on "Other device"

**Outlook/Office 365:**
1. IMAP is enabled by default
2. Use your normal email password
3. Host: `outlook.office365.com`, Port: 993

**Custom Server:**
1. Contact your email provider for IMAP settings
2. You'll need: host, port (usually 993), username, password

**Step 2: Add Email Integration in TimeTrack**
1. Go to Settings → Email Integration
2. Select your email provider (Gmail, Outlook, Custom)
3. Enter your email address
4. Enter your password (or app password for Gmail)
5. Click "Test Connection" to verify
6. Click "Save Configuration"

**Step 3: Configure Sync Settings**
1. Choose sync frequency (default: every 15 minutes)
2. Enable/disable automatic sync
3. Save settings

**Step 4: Review Auto-Created Tasks**
1. New tasks from emails appear in your task list with a 📧 icon
2. Review tasks with low AI confidence (<70%) in the "Needs Review" panel
3. Manually assign customers if AI didn't match correctly
4. Start tracking time on tasks as usual

### FAQs

**Q: Is my email password secure?**
A: Yes! Your password is encrypted using military-grade AES-256 encryption and never stored in plain text.

**Q: What happens if the AI matches the wrong customer?**
A: You can manually reassign the customer in the task details. The system learns from your corrections.

**Q: Can I reply to emails from TimeTrack?**
A: Not yet - this is planned for a future update. For now, reply in your email client as usual.

**Q: How much does this cost in OpenAI credits?**
A: Approximately $0.01-0.05 per email parsed. For 100 emails/month, that's $1-5/month. You can also use your own OpenAI API key (BYOK).

**Q: What if I want to exclude certain emails?**
A: Future enhancement - you'll be able to set up filters based on sender, subject, or keywords.

## 🎯 Success Criteria

### Functional Requirements

- ✅ Users can securely add IMAP credentials
- ✅ System fetches new emails every N minutes (configurable)
- ✅ AI parses email content into task fields with >80% accuracy
- ✅ Customer matching works with >85% accuracy (confidence > 0.85)
- ✅ Email replies update existing tasks automatically
- ✅ Users can view full email thread history for tasks
- ✅ Manual customer assignment for low-confidence matches
- ✅ Time tracking integration works seamlessly

### Non-Functional Requirements

- ✅ Password encryption meets security standards (AES-256)
- ✅ IMAP connections use SSL/TLS
- ✅ Background sync doesn't impact app performance
- ✅ Email processing completes within 10 seconds per email
- ✅ System handles IMAP connection failures gracefully
- ✅ GDPR compliant (data deletion, portability, consent)

### User Experience Requirements

- ✅ Setup process takes <5 minutes
- ✅ Error messages are clear and actionable
- ✅ Sync status is always visible
- ✅ Task list clearly distinguishes email-created tasks
- ✅ Customer match confidence is transparent to users

## 💡 Competitive Advantage

### Why This Feature Wins

1. **Unique in Danish Market:** No other Danish freelance CRM has this
2. **Billy.dk Inspiration:** Proven model that Danish users already trust
3. **Time Savings:** Eliminate 30-60 min/day of manual email-to-task copying
4. **Context Preservation:** Never lose email history for customer requests
5. **AI-Powered:** Modern approach that competitors lack
6. **Proactive Updates:** Tasks auto-update when customers reply
7. **Seamless Integration:** Works with existing task/time tracking system

### Marketing Angles

- _"Never manually create a task from an email again"_
- _"Like Billy's automatic receipts - but for customer tasks"_
- _"AI automatically knows which customer sent the email"_
- _"Full email context for every task - no more searching inbox"_
- _"Save 5 hours per week on email management"_

## 📝 Conclusion

This Email-to-Task feature represents a significant competitive advantage for TimeTrack in the Danish freelance CRM market. By automating the tedious process of converting customer emails into actionable tasks, we:

1. **Save User Time:** Reduce administrative overhead by 50%
2. **Improve Accuracy:** AI-powered parsing ensures consistent task quality
3. **Enhance Context:** Full email thread history provides complete customer context
4. **Differentiate Product:** Unique feature that competitors don't have
5. **Build Trust:** Danish users already trust Billy's email-based automation

**Implementation is straightforward** with existing infrastructure:
- Tasks table already has all required fields
- AI processing logs already in place
- User settings already support AI configuration
- Only need to add email integration and sync logic

**Next Steps:**
1. Review and approve this specification
2. Create database migrations for new tables
3. Begin Phase 1 implementation (Foundation)
4. Weekly demos to validate progress
5. Beta launch with 10-20 users
6. Full launch after validation

**Estimated Timeline:** 6 weeks to full production-ready implementation.

---

**Document Version:** 1.0
**Last Updated:** February 5, 2026
**Author:** Claude Code
**Status:** Draft - Awaiting Approval

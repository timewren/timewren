import { ImapFlow } from "imapflow";
import type {
  AddressObject,
  EmailAddress,
  Headers,
  StructuredHeader,
} from "mailparser";
import { simpleParser } from "mailparser";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  mailbox: string;
}

export interface EmailMessage {
  messageId: string;
  uid?: number;
  threadId?: string | null;
  inReplyTo?: string | null;
  references: string[];
  subject: string;
  from: { email: string; name?: string | null };
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
  headers: {
    listUnsubscribe?: string | null;
    precedence?: string | null;
    autoSubmitted?: string | null;
    xAutoResponseSuppress?: string | null;
    xMailer?: string | null;
    contentType?: string | null;
    xSpamStatus?: string | null;
    xSpamScore?: string | null;
    xSpamFlag?: string | null;
    returnPath?: string | null;
  };
}

export interface UidFetchResult {
  messages: EmailMessage[];
  uidValidity: number;
  highestUid: number;
}

export class ImapClientService {
  private client: ImapFlow;
  private mailbox: string;
  private port: number;

  constructor(config: ImapConfig) {
    this.mailbox = config.mailbox;
    this.port = config.port;
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: {
        user: config.user,
        pass: config.password,
      },
      logger: false,
      connectionTimeout: 15_000,
    });
  }

  async testConnection(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      const code =
        err instanceof Error ? (err as { code?: string }).code : undefined;
      if (code === "ETIMEDOUT" || code === "ECONNREFUSED") {
        throw new Error(
          `Could not connect to IMAP server (${code}). Check that the host and port are correct, and that outgoing port ${this.port} is not blocked by a firewall.`,
        );
      }
      if (err instanceof Error && !err.message) {
        throw new Error(
          code
            ? `Could not connect to IMAP server (${code})`
            : "Could not connect to IMAP server — check host, port, and TLS settings",
        );
      }
      throw err;
    }
    try {
      const lock = await this.client.getMailboxLock(this.mailbox);
      lock.release();
    } finally {
      await this.client.logout();
    }
  }

  async fetchNewEmails(sinceDate: Date): Promise<EmailMessage[]> {
    await this.client.connect();

    try {
      const lock = await this.client.getMailboxLock(this.mailbox);
      try {
        const uids = await this.client.search({ since: sinceDate });
        if (!uids || uids.length === 0) {
          return [];
        }

        return await this.parseMessages(uids);
      } finally {
        lock.release();
      }
    } finally {
      await this.client.logout();
    }
  }

  async fetchNewEmailsByUid(sinceUid: number): Promise<UidFetchResult> {
    await this.client.connect();

    try {
      const lock = await this.client.getMailboxLock(this.mailbox);
      try {
        const mailboxStatus = this.client.mailbox;
        const uidValidity =
          mailboxStatus && typeof mailboxStatus === "object"
            ? Number(mailboxStatus.uidValidity ?? 0)
            : 0;

        // Search for UIDs greater than sinceUid
        const searchUid = sinceUid + 1;
        const uids = await this.client.search({ uid: `${searchUid}:*` });

        // Filter out sinceUid itself (IMAP * can match the last UID)
        const filteredUids = Array.isArray(uids)
          ? uids.filter((u: number) => u > sinceUid)
          : [];

        if (filteredUids.length === 0) {
          return { messages: [], uidValidity, highestUid: sinceUid };
        }

        const messages = await this.parseMessages(filteredUids);
        const highestUid = Math.max(
          sinceUid,
          ...messages.map((m) => m.uid || 0),
        );

        return { messages, uidValidity, highestUid };
      } finally {
        lock.release();
      }
    } finally {
      await this.client.logout();
    }
  }

  getMailboxUidValidity(): number {
    const mb = this.client.mailbox;
    return mb && typeof mb === "object" ? Number(mb.uidValidity ?? 0) : 0;
  }

  private async parseMessages(uids: number[]): Promise<EmailMessage[]> {
    const messages: EmailMessage[] = [];

    for await (const msg of this.client.fetch(uids, {
      envelope: true,
      source: true,
      uid: true,
      flags: true,
    })) {
      if (!msg.source) continue;

      const parsed = await simpleParser(msg.source);

      const from = parsed.from?.value?.[0];
      const to = flattenAddressObjects(parsed.to);
      const cc = flattenAddressObjects(parsed.cc);

      const messageId = parsed.messageId || msg.envelope?.messageId || "";
      if (!messageId) continue;

      const threadId = getHeaderValue(parsed.headers, "x-gm-thrid");
      const inReplyTo = parsed.inReplyTo || null;
      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];

      const attachments = (parsed.attachments || []).map((attachment) => ({
        filename: attachment.filename || "attachment",
        contentType: attachment.contentType || "application/octet-stream",
        size: attachment.size || 0,
        content: attachment.content,
      }));

      const normalizeAddresses = (entries: EmailAddress[]) =>
        entries
          .map((entry) => entry.address?.trim())
          .filter((address): address is string => Boolean(address));

      messages.push({
        messageId,
        uid: msg.uid,
        threadId,
        inReplyTo,
        references,
        subject: parsed.subject || "(uden emne)",
        from: {
          email: from?.address || "",
          name: from?.name || null,
        },
        to: normalizeAddresses(to),
        cc: normalizeAddresses(cc),
        receivedDate: parsed.date || new Date(),
        bodyText: parsed.text || "",
        bodyHtml: parsed.html ? String(parsed.html) : "",
        attachments,
        headers: {
          listUnsubscribe: getHeaderValue(parsed.headers, "list-unsubscribe"),
          precedence: getHeaderValue(parsed.headers, "precedence"),
          autoSubmitted: getHeaderValue(parsed.headers, "auto-submitted"),
          xAutoResponseSuppress: getHeaderValue(
            parsed.headers,
            "x-auto-response-suppress",
          ),
          xMailer: getHeaderValue(parsed.headers, "x-mailer"),
          contentType: getHeaderValue(parsed.headers, "content-type"),
          xSpamStatus: getHeaderValue(parsed.headers, "x-spam-status"),
          xSpamScore:
            getHeaderValue(parsed.headers, "x-spam-score") ||
            getHeaderValue(parsed.headers, "x-rspamd-score"),
          xSpamFlag: getHeaderValue(parsed.headers, "x-spam-flag"),
          returnPath: getHeaderValue(parsed.headers, "return-path"),
        },
      });
    }

    return messages;
  }
}

function flattenAddressObjects(
  input?: AddressObject | AddressObject[],
): EmailAddress[] {
  if (!input) {
    return [];
  }

  const list = Array.isArray(input) ? input : [input];
  return list.flatMap((entry) => entry.value ?? []);
}

function getHeaderValue(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (!value) return null;

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : null;
  }

  if (isStructuredHeader(value)) {
    return value.value ?? null;
  }

  return null;
}

function isStructuredHeader(value: unknown): value is StructuredHeader {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

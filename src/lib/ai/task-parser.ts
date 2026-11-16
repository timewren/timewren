import { toLocalDateStr } from "@/lib/format";
import { copenhagenToday, copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import { isDisposableEmail } from "@/lib/utils/email-blocklist";
import {
  DEFAULT_MODEL,
  getOpenAI,
  getOpenAIForUser,
  isAIEnabled,
  isAIEnabledForUser,
} from "./openai";
import {
  buildSafePrompt,
  detectInjectionAttempt,
  sanitizeForPrompt,
} from "./sanitize";

// System prompt for parsing emails and natural language into tasks
const TASK_PARSING_SYSTEM_PROMPT = `Du er en intelligent assistent der hjælper danske freelancere med at organisere deres opgaver.
Din opgave er at parse naturligt sprog og emails til strukturerede opgavedata.

SPROG: Du skal ALTID generere titel og beskrivelse på DANSK — uanset om emailen er skrevet på engelsk, tysk eller andet. Oversæt indholdet til naturligt dansk. Eksempler:
- Engelsk email "Can you update the website by Friday?" → Titel: "Opdatér hjemmesiden inden fredag"
- Engelsk email "Please review the attached contract" → Titel: "Gennemgå den vedhæftede kontrakt"
- Tysk email "Bitte senden Sie die Rechnung" → Titel: "Send fakturaen"

Du skal udtrække følgende information:
1. isActionable: Om teksten indeholder en reel opgave der kræver handling (true/false)
2. Titel: En kort, handlingsorienteret titel på DANSK (max 100 tegn). VIGTIGT: Udtrk den KONKRETE HANDLING fra emailens indhold — brug IKKE bare emnelinjen. Titlen skal starte med et verbum når muligt.
   - Emne "Re: Hjemmeside" + body "kan du fikse kontaktformularen" → "Ret kontaktformularen på hjemmesiden"
   - Emne "Opdatering" + body "vi har brug for nye billeder på forsiden" → "Tilføj nye billeder til forsiden"
   - Emne "Hej" + body "kan vi mødes tirsdag kl 10?" → "Møde tirsdag kl. 10"
   Hvis emnelinjen allerede beskriver handlingen præcist, brug den (oversat til dansk).
3. Beskrivelse: Uddybende kontekst på dansk. Inkludér: hvem der bad om det (afsenderens navn), nøgledetaljer, og eventuelt citér den vigtigste sætning fra emailen.
4. Prioritet: "low", "medium", "high", eller "urgent"
5. Deadline: En ISO-dato hvis nævnt, ellers null
6. Estimeret tid: Antal minutter hvis du kan vurdere det, ellers null

isActionable vurdering:
- true: Kundeforespørgsler, opgavebeskrivelser, mødeindkaldelser, anmodninger om handling, feedback der kræver opfølgning
- false: Nyhedsbreve, automatiske notifikationer, kvitteringer, reklame, out-of-office svar, generelle informationsmails uden handling, takkebeskeder uden opfølgning

Prioritets-indikatorer:
- "urgent": "haster", "asap", "straks", "øjeblikkeligt", "kritisk", "urgent", "nu", "ASAP"
- "high": "vigtig", "vigtigt", "snarest", "prioriter", "important", "priority"
- "medium": Default hvis ingen indikation
- "low": "når du har tid", "ikke hastende", "lavprioriteret", "someday", "no rush", "low priority"

Deadline-udtræk:
- "i morgen" / "tomorrow" = næste dag
- "i overmorgen" = 2 dage
- "om X dage" / "in X days" = X dage frem
- "inden [ugedag]" / "by [weekday]" = næste forekomst af den dag
- "næste uge" / "next week" = mandag i næste uge
- "inden månedens udgang" / "end of month" = sidste dag i måneden
- Specifikke datoer som "15/3", "15. marts", "2024-03-15", "March 15"

Tidsestimering guidelines:
- Simpel email/telefonopkald: 15-30 min
- Research/undersøgelse: 60-120 min
- Møde: 60 min default
- Dokumentation: 30-60 min
- Udvikling/kode: 120-240 min
- Review: 30-60 min

VIGTIGT: Svar KUN med valid JSON. Ingen markdown, ingen forklaringer.`;

const TASK_PARSING_USER_TEMPLATE = `Parse følgende tekst til en opgave. Titel og beskrivelse SKAL være på dansk.

"""
{input}
"""

Dagens dato er: {today}

Svar med JSON i dette format:
{
  "isActionable": true | false,
  "title": "string (DANSK)",
  "description": "string | null (DANSK)",
  "priority": "low" | "medium" | "high" | "urgent",
  "deadline": "ISO-date string | null",
  "estimatedMinutes": "number | null",
  "confidence": 0.0-1.0
}`;

export interface ParsedTask {
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  deadline: string | null;
  estimatedMinutes: number | null;
  confidence: number;
  isActionable: boolean;
  isUncertain?: boolean;
}

export interface EmailInput {
  subject: string;
  body: string;
  from: string;
  receivedAt?: string;
  headers?: {
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

/**
 * Parse natural language text into a structured task
 * @param text - The text to parse
 * @param userId - Optional user ID for user-specific AI configuration
 */
export async function parseTextToTask(
  text: string,
  userId?: string,
): Promise<ParsedTask> {
  // Check if AI is enabled (user-specific or system-level)
  const aiEnabled = userId ? await isAIEnabledForUser(userId) : isAIEnabled();

  if (!aiEnabled) {
    // Fallback: Basic parsing without AI
    return fallbackParseText(text);
  }

  try {
    // Check for potential prompt injection attempts (for logging/monitoring)
    if (detectInjectionAttempt(text)) {
      console.warn(
        "Potential prompt injection attempt detected in task parsing",
      );
    }

    const today = copenhagenToday();

    // Sanitize user input before inserting into prompt
    const userPrompt = buildSafePrompt(TASK_PARSING_USER_TEMPLATE, {
      input: text,
      today: today,
    });

    // Get AI client (user-specific or system-level)
    const { client, model } = userId
      ? await getOpenAIForUser(userId)
      : { client: getOpenAI(), model: DEFAULT_MODEL };

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: TASK_PARSING_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3, // Low temperature for consistent parsing
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as ParsedTask;

    // Validate and normalize the response
    return {
      title: parsed.title?.slice(0, 200) || text.slice(0, 200),
      description: parsed.description || null,
      priority: validatePriority(parsed.priority),
      deadline: parsed.deadline || null,
      estimatedMinutes: parsed.estimatedMinutes || null,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      isActionable: parsed.isActionable !== false,
    };
  } catch (error) {
    console.error("AI task parsing failed:", error);
    return fallbackParseText(text);
  }
}

/**
 * Strip common email reply/forward prefixes from a subject line
 */
function stripSubjectPrefixes(subject: string): string {
  // Recursively strip Re:, Fwd:, SV:, VS:, FW: prefixes (case-insensitive)
  let cleaned = subject.trim();
  let previous = "";
  while (cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(/^(Re|Fwd|FW|SV|VS)\s*:\s*/i, "").trim();
  }
  return cleaned;
}

// Known notification/no-reply domains — emails from these are never actionable
const NOTIFICATION_SENDER_DOMAINS = [
  // Social media
  "facebookmail.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "pinterest.com",
  "tiktok.com",
  // Dev/tech platforms
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "atlassian.com",
  "jira.com",
  "trello.com",
  "slack.com",
  "notion.so",
  "figma.com",
  "vercel.com",
  "netlify.com",
  "heroku.com",
  "digitalocean.com",
  "sentry.io",
  "datadog.com",
  "pagerduty.com",
  // E-commerce / services
  "amazon.com",
  "amazon.de",
  "amazon.co.uk",
  "ebay.com",
  "ebay.dk",
  "paypal.com",
  "stripe.com",
  "wise.com",
  "revolut.com",
  // Cloud providers
  "google.com",
  "googleapis.com",
  "microsoft.com",
  "outlook.com",
  "office365.com",
  "apple.com",
  "dropbox.com",
  "icloud.com",
  // Marketing/email platforms
  "mailchimp.com",
  "sendinblue.com",
  "hubspot.com",
  "mailgun.com",
  "sendgrid.net",
  "mandrillapp.com",
  "constantcontact.com",
  "campaignmonitor.com",
  // Danish services
  "postnord.dk",
  "gls-group.eu",
  "dao.as",
  "nemid.nu",
  "mitid.dk",
  "borger.dk",
  "skat.dk",
  "nets.dk",
  "mobilepay.dk",
  "virk.dk",
  "nemhandel.dk",
  "dandomain.dk",
  "one.com",
  "simply.com",
  // SaaS / platforms
  "shopify.com",
  "squarespace.com",
  "wix.com",
  "zendesk.com",
  "intercom.io",
  "freshdesk.com",
  "calendly.com",
  "typeform.com",
  "surveymonkey.com",
  "canva.com",
  "asana.com",
  "monday.com",
  "zoom.us",
  "webex.com",
  "twilio.com",
  "cloudflare.com",
  "namecheap.com",
  "godaddy.com",
  "ovhcloud.com",
  "hetzner.com",
  "linode.com",
  "akamai.com",
  // Finance
  "klarna.com",
  "afterpay.com",
  // Analytics / marketing
  "hotjar.com",
  "mixpanel.com",
  "segment.com",
  "amplitude.com",
  "intercom.com",
  "crisp.chat",
  "drift.com",
  "beehiiv.com",
  "substack.com",
  "convertkit.com",
  "activecampaign.com",
  // Project/productivity
  "basecamp.com",
  "clickup.com",
  "todoist.com",
  "airtable.com",
  "miro.com",
  "loom.com",
  // Danish business/finance
  "danskebank.dk",
  "nordea.dk",
  "jyske-bank.dk",
  "lunar.app",
  "billy.dk",
  "dinero.dk",
  "e-conomic.dk",
  "visma.dk",
  "penneo.com",
  "trustpilot.com",
  // Hosting / DNS
  "hostinger.com",
  "kinsta.com",
  "wpengine.com",
  "siteground.com",
  "bluehost.com",
  "dreamhost.com",
  // CI/CD / DevOps
  "circleci.com",
  "travis-ci.com",
  "jenkins.io",
  "docker.com",
  "fly.io",
  "railway.app",
  // Recruiting / job boards
  "indeed.com",
  "glassdoor.com",
  "thehub.io",
  "ofir.dk",
  "jobindex.dk",
  // SEO / link spam
  "ahrefs.com",
  "semrush.com",
  "moz.com",
];

// Automated sender prefix patterns
const AUTOMATED_SENDER_PATTERNS = [
  /^(noreply|no-reply|do-not-reply|donotreply|ikke-svar|ikkesvar)@/i,
  /^(mailer-daemon|postmaster|bounce|bounces|mail-daemon)@/i,
  /^(notifications?|notification-|notify|notifikation)@/i,
  /^(alerts?|alert-|advarsel)@/i,
  /^(billing|invoice|receipt|order|shipping|support|info|news|updates)@/i,
  /^(system|admin|automated|auto|robot|bot|cron)@/i,
  /^(digest|summary|report|cron|scheduler)@/i,
  /^(calendar|invite|events?|kalender)@/i,
  /^(feedback|survey|nps|tilfredshed)@/i,
  /^(security|verify|verification|confirm|confirmation)@/i,
  /^(marketing|promo|promotions?|deals|offers|sales|campaign)@/i,
  /^(newsletter|news|weekly|monthly|daily|digest|nyhedsbrev)@/i,
  /^(hello|hi|welcome|onboarding|activation|getstarted|velkommen)@/i,
  /^(status|statuspage|monitoring|uptime)@/i,
  /^(community|forum|comments?|discuss)@/i,
  /^(team|workspace|account|service|konto)@/i,
  /^(wordpress|wp|backup|wpvivid|wordfence|sucuri)@/i,
  /^(git|github|gitlab|bitbucket|deploy|ci|cd)@/i,
];

// Auto-reply / out-of-office subject patterns
const AUTO_REPLY_PATTERNS =
  /^(auto:|automatic reply:|fraværsbesked:|out of office|autosvar:|afwezig|abwesenheit|delivery status|undelivered|undeliverable|mail delivery|failure notice|returned mail)/i;

// WordPress / CMS / hosting automated alert subject patterns
const CMS_ALERT_SUBJECT_PATTERNS = [
  // Wordfence
  /^\[wordfence\s*(alert)?\]/i,
  /wordfence\s*(activity|alert|scan)/i,
  // Sucuri
  /^sucuri\s*alert/i,
  // MainWP
  /uptime\s*monitoring\s*(alert)?/i,
  /daily\s*digest\s*from\s*your\s*mainwp/i,
  // WordPress auto-updates
  /plugins?\s*(blev|were|was)\s*(automatisk\s*)?(opdateret|updated)/i,
  /nogle\s*plugins\s*blev\s*automatisk\s*opdateret/i,
  // WordPress comment moderation
  /^\[.*\]\s*please\s*moderate/i,
  // WordPress new user registration
  /^\[.*\]\s*new\s*user\s*registration/i,
  // Piwigo / CMS update notices
  /piwigo\s*\d+.*is\s*available.*please\s*update/i,
  /is\s*available.*please\s*update/i,
  // WordPress automated alerts
  /\[.*\]\s*Advarsel om filændring/i,
  /\[.*\]\s*Backup (Failed|Completed|Succeeded)/i,
  /Backup Failed.*WPvivid/i,
  /Wordfence (Alert|Warning)/i,
  /Administrator Toolkit/i,
  // Generic monitoring / uptime
  /no\s*downtime\s*this\s*week/i,
  /uptime\s*(report|monitoring|status)/i,
  /Uptime (Monitoring|Alert|Report)/i,
  /WordPress audit/i,
  /statusrapport\s*for\s*uge/i,
  // Email sending stats (FluentSMTP etc.)
  /email\s*sending\s*stats\s*for/i,
  // Security alerts from plugins
  /security\s*alert.*plugin.*activated/i,
  // Elementor / SaaS onboarding
  /please\s*confirm\s*your\s*email\s*address/i,
  /confirm\s*your\s*email/i,
  // Calendar events
  /^(Cancelled|Updated|Accepted|Declined|Tentative)\s+(event|invitation):/i,
  /^Invitation:/i,
  // Domain renewal
  /Domæne:.*Forny nu/i,
  /domain.*renew/i,
  // Timesheet/payroll reminders
  /Husk at indsende ugeseddel/i,
];

// Promotional / spam subject patterns
const PROMOTIONAL_SUBJECT_PATTERNS = [
  // Dansk
  /\d+%\s*(rabat|off)/i,
  /(gratis|free)\s+(levering|fragt|shipping|trial|prøve)/i,
  /\b(tilbud|udsalg|kampagne|black friday|cyber monday)\b/i,
  /\b(vind|vundet)\s+(en|et|din|gratis)/i,
  /\bkonkurrence\b/i,
  /sidste chance|skynd dig|kun i dag/i,
  /eksklusiv(t)?\s*(tilbud|rabat|deal|adgang)/i,
  /spar\s+\d+/i,
  // English
  /flash sale|clearance|doorbuster|deal of the day/i,
  /claim your|redeem your|activate your\s+(offer|discount|reward|coupon)/i,
  /\b(save|earn)\s+\d+%/i,
  /buy\s+\d+\s+get\s+\d+/i,
  /free gift|bonus offer|special promotion/i,
  /limited\s+time\s+(offer|deal|only)/i,
  /act now|don'?t miss|hurry/i,
  /exclusive\s+(offer|deal|discount|access|invite)/i,
  /\bunsubscribe\b.*\b(click|here|link)\b/i,
  /lucky\s*winner|congratulations.*won/i,
  // Cold outreach patterns
  /boost\s*your\s*(brand|business|reputation|traffic|sales)/i,
  /convert\s*your\s*traffic/i,
  /trusted\s*review/i,
  /run\s*.*free\s*for\s*\d+\s*days/i,
  /you'?re\s*off\s*to\s*a\s*great\s*start/i,
  /get\s*more\s*with/i,
  // Re-engagement / win-back emails
  /vi\s*savner\s*dig/i,
  /we\s*miss\s*you/i,
  /\d+\s*dage?\s*siden\s*dit\s*sidste\s*besøg/i,
  // Urgency emoji marketing
  /(⏰|🔥|🚀|💥|⚡️|⚡)\s/u,
  // Personalized marketing with urgency
  /Ready to.*\?$/i,
  /Clock.s Ticking/i,
  /Await!$/i,
  // Survey/feedback requests
  /feedback.*improve/i,
  /Share Feedback/i,
  // Weekly/monthly report subjects
  /ugentlig\s*.*rapport/i,
  /weekly\s*.*report/i,
  // SaaS product announcements in subject
  /prisjustering/i,
  /nye\s*kampagner/i,
  // Urgency marketing patterns
  /Clock's Ticking/i,
  /Level-Up Your/i,
  /Training.*Await/i,
  /Ready to Level/i,
  /Du er udvalgt/i,
  /kundetilfredshedsundersøgelse/i,
  // Recruitment spam
  /Konsulentopgave/i,
  /Ny Relevant Opgave/i,
  // SEO / link spam
  /Guest Post (Contribution|Opportunity|Inquiry)/i,
  /Tilmeld.*Marketplace/i,
  /Linkfabrikken/i,
  /link\s*(building|exchange|partnership|insertion)/i,
  /backlink\s*(opportunity|exchange|proposal)/i,
  /I\s*(noticed|found|visited)\s*your\s*(website|site|blog)/i,
  /collaboration\s*opportunity/i,
  /sponsored\s*(post|content|article)/i,
  /write\s*for\s*(us|you)/i,
  /content\s*partnership/i,
  // Cold sales / outreach
  /quick\s*(question|call|chat|demo)\??$/i,
  /Are you the right person/i,
  /Er du den rette person/i,
  /Re: .{0,5}$/i, // Fake "Re:" with near-empty subject
];

// Transactional / notification subject patterns
const TRANSACTIONAL_SUBJECT_PATTERNS = [
  /^\S+ ordre-eksport \d{2}-\d{2}-\d{4}$/i,
  /din (ordre|bestilling|betaling|kvittering|faktura)\s*(#|nr|nummer)/i,
  /your (order|payment|receipt|invoice|subscription)/i,
  /order\s*(confirmation|confirmed|shipped|delivered)/i,
  /(bekræftelse|confirmation) (af|of|på)/i,
  /password\s*(reset|changed|updated)/i,
  /adgangskode\s*(nulstillet|ændret)/i,
  /log\s*in\s*(alert|notification|attempt)/i,
  /new\s*sign[\s-]in/i,
  /two[\s-]factor|2fa|verification code|bekræftelseskode/i,
  /welcome to|velkommen til/i,
  /subscription\s*(renewed|cancelled|expiring)/i,
  /abonnement\s*(fornyet|opsagt)/i,
  /din (pakke|forsendelse)\s*(er|blev)/i,
  /your (package|shipment|delivery)\s*(has|was|is)/i,
  /tracking\s*(number|update|information)/i,
  /scheduled\s*maintenance|planlagt\s*vedligeholdelse/i,
  /weekly\s*(digest|summary|report)/i,
  /monthly\s*(digest|summary|report)/i,
  /ugentlig\s*(oversigt|rapport|opsummering)/i,
  /månedlig\s*(oversigt|rapport|opsummering)/i,
  // Calendar invitations (Google Calendar, Outlook)
  /^invitation:/i,
  /^accepted:/i,
  /^declined:/i,
  /^tentative:/i,
  /^cancelled:/i,
  // SaaS product update announcements
  /\bupdate[s]?\b.*\bjust\s*shipped\b/i,
  /\bnew\s*feature/i,
  /\bbeta\s*is\s*live\b/i,
  /call\s*for\s*speakers/i,
  // Invoice/receipt transactional
  /^Faktura #\d+$/i,
  /^Din ordre er blevet modtaget/i,
  /^Ordre \d+$/i,
];

// Strong marketing signals — a single match means non-actionable
const STRONG_MARKETING_PATTERNS = [
  /click\s*(here\s*)?(to\s*)?unsubscribe/i,
  /klik\s*(her\s*)?(for at\s*)?afmelde/i,
  /view\s*(this\s*)?(email\s*)?in\s*(your\s*)?browser/i,
  /se\s*(denne\s*)?(email\s*)?i\s*(din\s*)?browser/i,
  /you\s*(are|were)\s*subscribed\s*to/i,
  /du\s*(er|blev)\s*tilmeldt/i,
  /this\s*(email|message)\s*was\s*sent\s*(to|by)\s*.*\s*list/i,
  /email\s*sent\s*to\s*{{|%%|%25/i, // Template variables = mass mail
  /too many images to display|view images/i,
  // WordPress automated body patterns
  /this\s*email\s*was\s*sent\s*.*by\s*the\s*wordfence\s*plugin/i,
  /this\s*email\s*was\s*generated\s*by\s*your\s*mainwp\s*dashboard/i,
  /click\s*here\s*to\s*upgrade\s*to\s*wordfence\s*premium/i,
  /der\s*er\s*ikke\s*behov\s*for\s*yderligere\s*handlinger/i,
  /plugins?\s*(er|is|are)\s*(nu\s*)?(automatisk\s*)?(opdateret|updated)/i,
  /denne\s*meddelelse\s*blev\s*sent?\s*til\s*dig\s*fra\s*adtraction/i,
  /this\s*message\s*was\s*sent\s*to\s*you\s*from\s*the\s*.*partner\s*program/i,
  // Affiliate network notifications
  /ansøg\s*her\s*->\s*/i,
  // Cold outreach / unsolicited sales
  /reach\s*me\s*on\s*telegram/i,
  /whats?\s*app\s*:\s*\+\d/i,
  /i\s*(help|work\s*with)\s*businesses.*\b(reputation|reviews?|trustpilot|sales)\b/i,
  /i\s*(came\s*across|found|noticed)\s*your\s*(website|company|business)/i,
  /we\s*(specialize|help\s*(companies|businesses))\s*in/i,
  /book\s*a\s*(free\s*)?(call|demo|consultation)/i,
  /schedule\s*a\s*(quick\s*)?(call|meeting|demo)/i,
];

// Weak marketing signals — 2+ matches means non-actionable
const WEAK_MARKETING_PATTERNS = [
  /unsubscribe|afmeld|frameld|afbestil/i,
  /email\s*preferences|email[\s-]indstillinger/i,
  /manage\s*(your\s*)?(notification|email)\s*settings/i,
  /administrer\s*(dine\s*)?(notifikation|email)[\s-]?indstillinger/i,
  /you('re| are) receiving this (because|email)/i,
  /du modtager denne (email|besked|mail) fordi/i,
  /this is an automated (message|email|notification)/i,
  /dette er en automatisk (besked|email|meddelelse)/i,
  /do not reply (to this|directly)/i,
  /svar ikke (på denne|direkte)/i,
  /©\s*\d{4}/,
  /all rights reserved|alle rettigheder forbeholdes/i,
  /powered by\s+(mailchimp|hubspot|sendgrid|sendinblue|brevo|activecamp)/i,
  /update\s*(your\s*)?preferences/i,
  /privacy\s*policy|privatlivspolitik/i,
  /terms\s*(of\s*)?(service|use)|servicevilkår|brugsvilkår/i,
  /sent\s*from\s*your\s*dashboard/i,
  /knowledgebase\s*article/i,
  /wordpress[\s-]holdet/i,
  /de\s*frivillige\s*hos\s*wordpress\.org/i,
  /upgrade\s*to\s*(wordfence|sucuri|mainwp)\s*premium/i,
  /you\s*are\s*using\s*the\s*free\s*version/i,
  /no\s*longer\s*an\s*administrator.*click\s*here/i,
  /drives\s*af\s*"?piwigo"?/i,
  /boring,?\s*legal\s*bit/i,
  /you\s*can\s*(also\s*)?unsubscribe/i,
  /manage\s*email\s*subscriptions/i,
  /don'?t\s*like\s*these\s*emails/i,
  /if\s*you\s*(no\s*longer|don'?t)\s*want\s*to\s*receive/i,
  /stop\s*receiving\s*(these|this|security)\s*(emails?|alerts?|messages?)/i,
  // Newsletter body patterns
  /læsetid\s*\d+:\d+\s*min/i,
  /read\s*time:?\s*\d+\s*min/i,
  /\(læsetid\s*/i,
];

/**
 * Rule-based email classification — runs WITHOUT AI.
 * Determines if an email is actionable and extracts task data from subject/body.
 *
 * Filter order:
 * 1. Header-based (List-Unsubscribe, Precedence, Auto-Submitted, calendar)
 * 2. Notification domain list
 * 3. Automated sender patterns (noreply, notifications@, billing@, etc.)
 * 4. Auto-reply / out-of-office subjects
 * 5. Newsletter subject patterns
 * 6. Transactional subject patterns
 * 7. Body-based marketing detection (2+ matches required)
 * 8. Empty email check
 * 9. → Everything else: isActionable: true
 */
export function classifyEmail(
  email: EmailInput,
  options?: {
    senderReputation?: { actionable: boolean; confidence: number } | null;
  },
): ParsedTask {
  const sender = email.from.toLowerCase();
  const subject = email.subject.trim();
  const lowerSubject = subject.toLowerCase();
  const body = cleanEmailBody(email.body);
  const lowerBody = body.toLowerCase();
  const combinedText = `${subject} ${body}`;
  const fallbackTitle = stripSubjectPrefixes(subject) || email.subject;

  // --- Relevance filter: return isActionable: false if matched ---

  // 0. Sender reputation from classification cache (learned from past emails)
  if (
    options?.senderReputation &&
    !options.senderReputation.actionable &&
    options.senderReputation.confidence >= 0.7
  ) {
    return nonActionableResult(fallbackTitle);
  }

  // 1. Header-based detection (most reliable)
  if (email.headers) {
    if (email.headers.listUnsubscribe) {
      return nonActionableResult(fallbackTitle);
    }
    if (
      email.headers.precedence &&
      /^(bulk|list|junk)$/i.test(email.headers.precedence)
    ) {
      return nonActionableResult(fallbackTitle);
    }
    if (email.headers.autoSubmitted && email.headers.autoSubmitted !== "no") {
      return nonActionableResult(fallbackTitle);
    }
    if (email.headers.xAutoResponseSuppress) {
      return nonActionableResult(fallbackTitle);
    }
    if (
      email.headers.contentType &&
      /text\/calendar|application\/ics/i.test(email.headers.contentType)
    ) {
      return nonActionableResult(fallbackTitle);
    }
  }

  // 2. Known notification domains
  const senderDomain = sender.split("@")[1];
  if (
    senderDomain &&
    NOTIFICATION_SENDER_DOMAINS.some((d) => senderDomain.endsWith(d))
  ) {
    return nonActionableResult(fallbackTitle);
  }

  // 2.5. Disposable email domains
  if (isDisposableEmail(sender)) {
    return nonActionableResult(fallbackTitle);
  }

  // 3. Automated sender patterns (expanded)
  if (AUTOMATED_SENDER_PATTERNS.some((p) => p.test(sender))) {
    return nonActionableResult(fallbackTitle);
  }

  // 4. Auto-reply / out-of-office subjects (expanded)
  if (AUTO_REPLY_PATTERNS.test(lowerSubject)) {
    return nonActionableResult(fallbackTitle);
  }

  // 5. Newsletter indicators in subject
  if (/newsletter|nyhedsbrev/i.test(lowerSubject)) {
    return nonActionableResult(fallbackTitle);
  }

  // 5.1. Newsletter-style subject patterns (numbered issues, read times)
  if (/^#\d+\s/.test(subject) || /læsetid\s*\d+/i.test(subject)) {
    return nonActionableResult(fallbackTitle);
  }

  // 5.5. WordPress / CMS / hosting automated alerts
  if (CMS_ALERT_SUBJECT_PATTERNS.some((p) => p.test(subject))) {
    return nonActionableResult(fallbackTitle);
  }

  // 6. Transactional subject patterns
  if (TRANSACTIONAL_SUBJECT_PATTERNS.some((p) => p.test(lowerSubject))) {
    return nonActionableResult(fallbackTitle);
  }

  // 6.5. Promotional / spam subject patterns
  if (PROMOTIONAL_SUBJECT_PATTERNS.some((p) => p.test(lowerSubject))) {
    return nonActionableResult(fallbackTitle);
  }

  // 7a. Strong marketing body signals (1 match = non-actionable)
  if (STRONG_MARKETING_PATTERNS.some((p) => p.test(lowerBody))) {
    return nonActionableResult(fallbackTitle);
  }

  // 7b. Weak marketing body signals (2+ matches = non-actionable)
  const weakMarketingCount = WEAK_MARKETING_PATTERNS.filter((p) =>
    p.test(lowerBody),
  ).length;
  if (weakMarketingCount >= 2) {
    return nonActionableResult(fallbackTitle);
  }

  // 7c. URL density check — many links relative to text = marketing
  if (hasHighUrlDensity(body)) {
    return nonActionableResult(fallbackTitle);
  }

  // Track uncertainty signals for AI fallback
  let uncertaintySignals = 0;
  if (weakMarketingCount === 1) uncertaintySignals++;

  // 8. Spam-related headers
  if (email.headers) {
    if (email.headers.xSpamFlag === "YES") {
      return nonActionableResult(fallbackTitle);
    }
    if (email.headers.xSpamScore) {
      const score = Number.parseFloat(email.headers.xSpamScore);
      if (!Number.isNaN(score) && score >= 5.0) {
        return nonActionableResult(fallbackTitle);
      }
    }
  }

  // 9. Empty subject with no meaningful body
  if (!subject && body.trim().length < 20) {
    return nonActionableResult("(Ingen emne)");
  }

  // Additional uncertainty: generic/short subject
  if (subject.length < 10 && !email.from.includes("@")) uncertaintySignals++;

  // Borderline sender pattern (matches some but not definitive)
  if (
    /^(team|hello|hi|info)@/i.test(sender) &&
    !AUTOMATED_SENDER_PATTERNS.some((p) => p.test(sender))
  ) {
    uncertaintySignals++;
  }

  // --- Extract title from subject ---
  const cleanedSubject = stripSubjectPrefixes(subject);
  let title = cleanedSubject;
  if (!title) {
    const firstSentence = body.match(/^[^\n.!?]+[.!?]?/);
    title = firstSentence
      ? firstSentence[0].trim().slice(0, 200)
      : "(Ingen emne)";
  }

  // --- Priority via keyword matching ---
  const lowerCombined = combinedText.toLowerCase();
  let priority: ParsedTask["priority"] = "medium";
  if (/haster|asap|straks|kritisk|urgent|øjeblikkeligt/.test(lowerCombined)) {
    priority = "urgent";
  } else if (/vigtig|vigtigt|snarest|prioriter/.test(lowerCombined)) {
    priority = "high";
  } else if (
    /når du har tid|ikke hastende|lavprioriteret/.test(lowerCombined)
  ) {
    priority = "low";
  }

  // --- Deadline extraction ---
  let deadline: string | null = null;
  // Dansk dato som anker, uanset processens TZ (#649)
  const today = copenhagenTodayAnchor();

  if (/i morgen/i.test(combinedText)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    deadline = toLocalDateStr(tomorrow);
  } else if (/i overmorgen/i.test(combinedText)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    deadline = toLocalDateStr(dayAfter);
  } else {
    const daysMatch = combinedText.match(/om (\d+) dag/i);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + days);
      deadline = toLocalDateStr(futureDate);
    }
  }

  return {
    title: title.slice(0, 200),
    description: body.length > 0 ? body.slice(0, 2000) : null,
    priority,
    deadline,
    estimatedMinutes: null,
    confidence: 0.6,
    isActionable: true,
    isUncertain: uncertaintySignals > 0,
  };
}

function nonActionableResult(title: string): ParsedTask {
  return {
    title: title.slice(0, 200),
    description: null,
    priority: "medium",
    deadline: null,
    estimatedMinutes: null,
    confidence: 0.6,
    isActionable: false,
  };
}

/**
 * Parse an email into a structured task.
 * Pipeline: rule-based classification first, then optional AI enrichment.
 * @param email - The email to parse
 * @param userId - Optional user ID for user-specific AI configuration
 */
export async function parseEmailToTask(
  email: EmailInput,
  userId?: string,
  options?: {
    senderReputation?: { actionable: boolean; confidence: number } | null;
  },
): Promise<ParsedTask> {
  // 1. Always run rule-based classification first (with optional reputation data)
  const classified = classifyEmail(email, options);

  // 2. If not actionable, skip AI — no point enriching a newsletter
  if (!classified.isActionable) {
    return classified;
  }

  // 3. Try AI enrichment if enabled
  const aiEnabled = userId ? await isAIEnabledForUser(userId) : isAIEnabled();
  if (!aiEnabled) {
    return classified;
  }

  try {
    // Check for potential prompt injection attempts
    const fullText = `${email.subject} ${email.body}`;
    if (detectInjectionAttempt(fullText)) {
      console.warn(
        "Potential prompt injection attempt detected in email task parsing",
      );
    }

    // Sanitize email components before constructing AI input
    const sanitizedFrom = sanitizeForPrompt(email.from, {
      maxLength: 200,
      allowNewlines: false,
    });
    const sanitizedSubject = sanitizeForPrompt(email.subject, {
      maxLength: 500,
      allowNewlines: false,
    });
    const sanitizedBody = sanitizeForPrompt(cleanEmailBody(email.body), {
      maxLength: 2000,
      allowNewlines: true,
    });

    const inputText = `
Fra: ${sanitizedFrom}
Emne: ${sanitizedSubject}
${email.receivedAt ? `Modtaget: ${email.receivedAt}` : ""}

${sanitizedBody}
`.trim();

    const today = copenhagenToday();
    const userPrompt = buildSafePrompt(TASK_PARSING_USER_TEMPLATE, {
      input: inputText,
      today: today,
    });

    const { client, model } = userId
      ? await getOpenAIForUser(userId)
      : { client: getOpenAI(), model: DEFAULT_MODEL };

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: TASK_PARSING_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return classified;
    }

    const parsed = JSON.parse(content) as ParsedTask;

    // If AI says not actionable, trust it
    if (parsed.isActionable === false) {
      return {
        ...classified,
        isActionable: false,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
      };
    }

    // Use AI-enriched result (better title/description)
    return {
      title: parsed.title?.slice(0, 200) || classified.title,
      description: parsed.description || classified.description,
      priority: validatePriority(parsed.priority),
      deadline: parsed.deadline || classified.deadline,
      estimatedMinutes: parsed.estimatedMinutes || null,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
      isActionable: true,
    };
  } catch (error) {
    console.error(
      "AI email task parsing failed, using rule-based result:",
      error,
    );
    return classified;
  }
}

/**
 * Check if email body has a high URL-to-text ratio (typical for marketing emails)
 */
function hasHighUrlDensity(body: string): boolean {
  const urlCount = (body.match(/https?:\/\//gi) || []).length;
  if (urlCount < 4) return false;
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return false;
  return urlCount / wordCount > 0.05;
}

/**
 * Clean email body by removing signatures, quoted text, etc.
 */
function cleanEmailBody(body: string): string {
  let cleaned = body;

  // Remove common email signatures
  const signaturePatterns = [
    /^--\s*$/m,
    /^_{3,}$/m,
    /^Med venlig hilsen.*/im,
    /^Venlig hilsen.*/im,
    /^Best regards.*/im,
    /^Kind regards.*/im,
    /^Regards.*/im,
    /^Warm regards.*/im,
    /^Mvh\.?\s*$/im,
    /^Vh\.?\s*$/im,
    /^Sendt fra min iPhone/im,
    /^Sendt fra min iPad/im,
    /^Sendt fra min Samsung/im,
    /^Sendt fra min Android/im,
    /^Sent from my iPhone/im,
    /^Sent from my iPad/im,
    /^Sent from my Galaxy/im,
    /^Sent from my Samsung/im,
    /^Hent Outlook for/im,
    /^Get Outlook for/im,
    /^Von meinem iPhone gesendet/im,
    /^Envoy[ée] de mon iPhone/im,
  ];

  for (const pattern of signaturePatterns) {
    const match = cleaned.match(pattern);
    if (match?.index !== undefined) {
      cleaned = cleaned.slice(0, match.index);
    }
  }

  // Remove quoted replies (lines starting with >)
  cleaned = cleaned
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  // Remove excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // Limit length
  if (cleaned.length > 2000) {
    cleaned = `${cleaned.slice(0, 2000)}...`;
  }

  return cleaned;
}

/**
 * Fallback parsing when AI is not available
 */
function fallbackParseText(text: string): ParsedTask {
  const lowerText = text.toLowerCase();

  // Extract priority
  let priority: ParsedTask["priority"] = "medium";
  if (/haster|asap|straks|kritisk|urgent|øjeblikkeligt/.test(lowerText)) {
    priority = "urgent";
  } else if (/vigtig|vigtigt|snarest|prioriter/.test(lowerText)) {
    priority = "high";
  } else if (/når du har tid|ikke hastende|lavprioriteret/.test(lowerText)) {
    priority = "low";
  }

  // Extract deadline
  let deadline: string | null = null;
  // Dansk dato som anker, uanset processens TZ (#649)
  const today = copenhagenTodayAnchor();

  if (/i morgen/i.test(text)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    deadline = toLocalDateStr(tomorrow);
  } else if (/i overmorgen/i.test(text)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    deadline = toLocalDateStr(dayAfter);
  } else {
    const daysMatch = text.match(/om (\d+) dag/i);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      const futureDate = new Date(today);
      futureDate.setDate(futureDate.getDate() + days);
      deadline = toLocalDateStr(futureDate);
    }
  }

  // Extract title (first line or first sentence)
  let title = text.split("\n")[0].trim();
  if (title.length > 100) {
    const firstSentence = text.match(/^[^.!?]+[.!?]?/);
    title = firstSentence ? firstSentence[0].trim() : text.slice(0, 100);
  }

  return {
    title,
    description: text.length > title.length ? text : null,
    priority,
    deadline,
    estimatedMinutes: null,
    confidence: 0.3, // Low confidence for fallback
    isActionable: true, // Text-based input is assumed actionable
  };
}

/**
 * Validate and normalize priority value
 */
function validatePriority(priority: string): ParsedTask["priority"] {
  const valid = ["low", "medium", "high", "urgent"];
  if (valid.includes(priority)) {
    return priority as ParsedTask["priority"];
  }
  return "medium";
}

export interface AttachmentHint {
  priorityBoost?: "high" | "urgent";
  titlePrefix?: string;
  hasDocuments: boolean;
}

const INVOICE_PATTERNS =
  /faktura|invoice|regning|receipt|kvittering|credit.?note/i;
const CONTRACT_PATTERNS = /kontrakt|contract|aftale|agreement|tilbud|offer/i;
const IMAGE_ONLY_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|svg|webp|ico)$/i;

export function analyzeAttachments(
  attachments: { filename: string; contentType: string; size: number }[],
): AttachmentHint {
  if (!attachments.length) return { hasDocuments: false };

  const hasInvoice = attachments.some((a) => INVOICE_PATTERNS.test(a.filename));

  const hasContract = attachments.some((a) =>
    CONTRACT_PATTERNS.test(a.filename),
  );

  const hasDocuments = attachments.some(
    (a) =>
      a.contentType === "application/pdf" ||
      a.contentType.includes("word") ||
      a.contentType.includes("spreadsheet") ||
      a.contentType.includes("excel") ||
      /\.(pdf|docx?|xlsx?|pptx?|odt|ods)$/i.test(a.filename),
  );

  const onlyImages = attachments.every((a) =>
    IMAGE_ONLY_EXTENSIONS.test(a.filename),
  );

  if (onlyImages) return { hasDocuments: false };

  if (hasInvoice)
    return {
      priorityBoost: "high",
      titlePrefix: "Gennemgå faktura: ",
      hasDocuments: true,
    };
  if (hasContract)
    return {
      priorityBoost: "high",
      titlePrefix: "Gennemgå kontrakt: ",
      hasDocuments: true,
    };
  return { hasDocuments };
}

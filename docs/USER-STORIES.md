# User Stories & Tekniske Specifikationer - TimeTrack

## 📋 Hvordan man læser dette dokument

Hver feature er beskrevet med:
- **User Story**: "Som [rolle] vil jeg [handling] så jeg kan [værdi]"
- **Acceptance Criteria**: Konkrete krav der skal være opfyldt
- **Teknisk Specifikation**: Database schema, API endpoints, komponenter, implementeringsdetaljer

**Status legend:**
- ✅ Implementeret
- 🚧 Under udvikling
- 📅 Planlagt
- 🔮 Fremtid

---

## 🎯 FASE 1 - MVP Features (Manglende/Ufuldendte)

### 1. CVR-Opslag Integration

**Status:** 📅 Planlagt

**User Story:**
> Som freelancer vil jeg kunne indtaste et CVR-nummer og automatisk få udfyldt kundeoplysninger, så jeg slipper for at taste firma-information manuelt.

**Acceptance Criteria:**
- [ ] Indtastningsfelt til CVR-nummer i "Opret Kunde" formular
- [ ] "Hent fra CVR" knap der kalder CVR API
- [ ] Automatisk udfyldning af: Firmanavn, adresse, by, postnummer, telefon (hvis tilgængeligt)
- [ ] Visuel feedback mens data hentes (loading state)
- [ ] Fejlhåndtering hvis CVR ikke findes eller API fejler
- [ ] Mulighed for at overskrive auto-udfyldte data
- [ ] CVR-nummer validering (8 cifre)

**Teknisk Specifikation:**

```typescript
// API Route: /api/cvr (EKSISTERER ALLEREDE)
// Endpoint findes i: src/app/api/cvr/route.ts
// Skal integreres i klient-formularen

// Database: clients tabel
// Tilføj felt: cvr VARCHAR(8) NULLABLE

// React Component: src/components/forms/ClientForm.tsx
interface CVRLookupResult {
  name: string;
  address: string;
  city: string;
  zipCode: string;
  phone?: string;
  email?: string;
}

// tRPC endpoint: clients.lookupCVR
input: { cvr: string }
output: CVRLookupResult

// UI Flow:
1. Bruger indtaster CVR i felt
2. Klik "Hent fra CVR" knap
3. Loading spinner vises
4. API kald til /api/cvr med CVR-nummer
5. Success: Auto-udfyld felter med response data
6. Error: Vis fejlbesked "CVR ikke fundet" eller "API fejl"
7. Bruger kan redigere alle felter før gem
```

**Database Migration:**
```sql
ALTER TABLE clients ADD COLUMN cvr VARCHAR(8);
CREATE INDEX idx_clients_cvr ON clients(cvr);
```

**API Integration:**
```typescript
// Brug eksisterende API: https://distribution.virk.dk/cvr-permanent
// Implementering: src/lib/integrations/cvr.ts (SKAL OPRETTES)
```

---

### 2. Komplet Kundedetaljer Side

**Status:** 🚧 Under udvikling (basis findes, mangler features)

**User Story:**
> Som freelancer vil jeg have en samlet oversigt over alt der vedrører en kunde (projekter, timer, klippekort, fakturaer), så jeg hurtigt kan se kundens fulde historik og status.

**Acceptance Criteria:**
- [ ] Kundeinformation header med navn, CVR, kontaktinfo og edit-knap
- [ ] Tab-navigation mellem: Oversigt, Projekter, Timer, Klippekort, Fakturaer, Historik
- [ ] **Oversigt tab**: Key metrics (total timer, aktive projekter, klippekort-saldo, åben faktura-værdi)
- [ ] **Projekter tab**: Liste over alle projekter (aktive først) med status og timeforbrug
- [ ] **Timer tab**: Alle timeposter for kunden med filtrering og CSV-eksport
- [ ] **Klippekort tab**: Aktive og historiske klippekort med saldo-visning
- [ ] **Fakturaer tab**: Liste over fakturaer (kommer i Fase 2)
- [ ] **Historik tab**: Aktivitetslog (alle ændringer relateret til kunden)
- [ ] Quick actions: "Ny Timer", "Nyt Projekt", "Opret Faktura", "Arkivér Kunde"

**Teknisk Specifikation:**

```typescript
// Route: /dashboard/clients/[id]
// Component: src/app/dashboard/clients/[id]/page.tsx (FINDES, skal udvides)

// tRPC endpoints:
clients.getById(id: string) → Client
clients.getProjects(clientId: string) → Project[]
clients.getTimeEntries(clientId: string, filter?) → TimeEntry[]
clients.getPrepaidPackages(clientId: string) → PrepaidPackage[]
clients.getInvoices(clientId: string) → Invoice[] // Fase 2
clients.getActivityLog(clientId: string) → Activity[]

// State Management:
- URL params for active tab: ?tab=projects
- Local state for filters inden for hver tab
- React Query caching for alle data queries

// Components Structure:
<ClientDetailPage>
  <ClientHeader client={client} /> // Navn, CVR, contact, edit
  <Tabs defaultValue="overview">
    <TabsList /> // Oversigt, Projekter, Timer, Klippekort, Fakturaer
    <OverviewTab /> // Metrics cards
    <ProjectsTab /> // Projects table
    <TimeEntriesTab /> // Time entries table med filter
    <PrepaidPackagesTab /> // Klippekort list
    <InvoicesTab /> // Invoices table (Fase 2)
    <ActivityTab /> // Activity log
  </Tabs>
</ClientDetailPage>

// Database queries:
SELECT * FROM clients WHERE id = $1;
SELECT * FROM projects WHERE client_id = $1 ORDER BY created_at DESC;
SELECT * FROM time_entries WHERE client_id = $1 ORDER BY date DESC;
SELECT * FROM prepaid_packages WHERE client_id = $1 ORDER BY created_at DESC;

// Activity Log Query:
SELECT * FROM activity_log
WHERE entity_type = 'client' AND entity_id = $1
ORDER BY timestamp DESC;
```

**UI Components Needed:**
- MetricCard (for oversigt)
- ProjectsTable (med status badges)
- TimeEntriesTable (med edit/delete actions)
- PrepaidPackageCard (med progress bar for saldo)
- ActivityLogItem (timeline-style)
- TabNavigation (reusable)

---

### 3. Komplet Opgavestyring System

**Status:** 📅 Planlagt

**User Story:**
> Som freelancer vil jeg kunne oprette og organisere opgaver knyttet til projekter/kunder, så jeg kan holde styr på mit arbejde og starte timer direkte fra opgaver.

**Acceptance Criteria:**
- [ ] Opgaveliste side viser alle opgaver med status, deadline og prioritet
- [ ] Filtrering: Status (Åben/I gang/Afsluttet), Projekt, Kunde, Deadline
- [ ] Sortering: Deadline, Prioritet, Oprettelsesdato
- [ ] "Opret Opgave" formular med: Titel, Beskrivelse, Projekt/Kunde, Deadline, Prioritet
- [ ] Quick actions på hver opgave: Start Timer, Markér færdig, Rediger, Slet
- [ ] Visuel indikation af overskredte deadlines (rød)
- [ ] Kommende deadlines inden for 3 dage (gul)
- [ ] Opgave-detalje side med aktivitetshistorik
- [ ] Mulighed for at tilføje kommentarer til opgaver (Fase 2)
- [ ] Integration med stopur: Start timer fra opgave auto-linker til projekt/kunde

**Teknisk Specifikation:**

```typescript
// Database Schema
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open', // 'open', 'in_progress', 'completed'
  priority VARCHAR(20) DEFAULT 'medium', // 'low', 'medium', 'high', 'urgent'
  deadline TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_client_id ON tasks(client_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);

// tRPC Router: tasks
tasks.list(filter?: TaskFilter) → Task[]
tasks.getById(id: string) → Task
tasks.create(input: CreateTaskInput) → Task
tasks.update(id: string, input: UpdateTaskInput) → Task
tasks.delete(id: string) → { success: boolean }
tasks.markComplete(id: string) → Task
tasks.startTimer(taskId: string) → { timeEntryId: string }

// TypeScript Types
interface Task {
  id: string;
  userId: string;
  title: string;
  description?: string;
  projectId?: string;
  clientId?: string;
  status: 'open' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  project?: Project;
  client?: Client;
}

interface TaskFilter {
  status?: 'open' | 'in_progress' | 'completed';
  projectId?: string;
  clientId?: string;
  deadlineBefore?: Date;
  deadlineAfter?: Date;
  priority?: string;
}

// Routes:
/dashboard/tasks → TasksListPage
/dashboard/tasks/new → CreateTaskPage
/dashboard/tasks/[id] → TaskDetailPage
/dashboard/tasks/[id]/edit → EditTaskPage

// Components:
<TasksList /> // Hovedliste med filtre
<TaskCard /> // Enkelt opgave kort
<TaskForm /> // Opret/rediger formular
<TaskFilters /> // Filter sidebar
<TaskStatusBadge /> // Status badge (åben/i gang/færdig)
<TaskPriorityBadge /> // Prioritet badge
<DeadlineIndicator /> // Visuel deadline-status

// UI Features:
- Deadline farver:
  * Overskredet: Rød baggrund
  * < 3 dage: Gul baggrund
  * Normal: Grå tekst
- Priority farver:
  * Urgent: Rød
  * High: Orange
  * Medium: Gul
  * Low: Grøn
```

**Integration med Timer:**
```typescript
// Når bruger klikker "Start Timer" på en opgave:
1. Hent opgavens projekt og kunde
2. Åbn timer-modal forudfyldt med:
   - Project: opgavens projekt
   - Client: opgavens kunde
   - Description: opgavens titel
3. Start stopur automatisk
4. Gem task_id i time_entry metadata (JSON felt)
5. Opdater opgavestatus til 'in_progress'
```

---

## ⭐ FASE 2 - Vigtige Features

### 4. Billy/Dinero Integration

**Status:** 📅 Planlagt (Høj prioritet)

**User Story:**
> Som freelancer vil jeg kunne synkronisere mine kunder og fakturaer med Billy/Dinero, så jeg slipper for dobbelt-indtastning og kan holde min bogføring opdateret automatisk.

**Acceptance Criteria:**
- [ ] Integration settings side med valg mellem Billy eller Dinero
- [ ] OAuth flow for at forbinde Billy/Dinero konto
- [ ] "Synkroniser Kunder" knap - import af kunder fra Billy/Dinero
- [ ] "Synkroniser til Billy/Dinero" knap - eksport af nye kunder til bogføringssystem
- [ ] Når faktura oprettes i TimeTrack: Automatisk opret i Billy/Dinero (valgfrit)
- [ ] Status-sync: Når faktura betales i Billy/Dinero, opdater i TimeTrack
- [ ] Conflict resolution: Hvis kunde findes begge steder, lad bruger vælge hvilken der er korrekt
- [ ] Disconnect-funktion med advarsel om hvad der sker med data

**Teknisk Specifikation:**

```typescript
// Database Schema
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, // 'billy', 'dinero'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  organization_id VARCHAR(255), // Billy/Dinero org ID
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE TABLE sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL, // 'customers', 'invoices'
  direction VARCHAR(20) NOT NULL, // 'import', 'export'
  status VARCHAR(20) NOT NULL, // 'success', 'failed', 'partial'
  items_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

// Tilføj til clients tabel:
ALTER TABLE clients ADD COLUMN billy_id VARCHAR(255);
ALTER TABLE clients ADD COLUMN dinero_id VARCHAR(255);

// Tilføj til invoices tabel (når den oprettes):
ALTER TABLE invoices ADD COLUMN billy_id VARCHAR(255);
ALTER TABLE invoices ADD COLUMN dinero_id VARCHAR(255);

// API Routes:
/api/integrations/billy/oauth → OAuth redirect
/api/integrations/billy/callback → OAuth callback handler
/api/integrations/dinero/oauth → OAuth redirect
/api/integrations/dinero/callback → OAuth callback handler

// tRPC Router: integrations
integrations.connect(provider: 'billy' | 'dinero') → { authUrl: string }
integrations.disconnect(provider: 'billy' | 'dinero') → { success: boolean }
integrations.getStatus() → { billy?: Integration, dinero?: Integration }
integrations.syncCustomers(provider, direction: 'import' | 'export') → SyncResult
integrations.syncInvoices(provider, direction: 'import' | 'export') → SyncResult
integrations.getSyncLog(provider) → SyncLogEntry[]

// TypeScript Types
interface Integration {
  id: string;
  provider: 'billy' | 'dinero';
  isActive: boolean;
  lastSyncAt?: Date;
  organizationId?: string;
}

interface SyncResult {
  success: boolean;
  itemsProcessed: number;
  itemsFailed: number;
  errors?: string[];
}

// External API Integration
// Billy API: src/lib/integrations/billy.ts (FINDES ALLEREDE - skal udvides)
class BillyAPI {
  async getCustomers(): Promise<BillyCustomer[]>
  async createCustomer(customer: Customer): Promise<string>
  async getInvoices(): Promise<BillyInvoice[]>
  async createInvoice(invoice: Invoice): Promise<string>
  async getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus>
}

// Dinero API: src/lib/integrations/dinero.ts (SKAL OPRETTES)
class DineroAPI {
  async getContacts(): Promise<DineroContact[]>
  async createContact(customer: Customer): Promise<string>
  async getInvoices(): Promise<DineroInvoice[]>
  async createInvoice(invoice: Invoice): Promise<string>
}

// UI Components:
<IntegrationSettings /> // Oversigt over forbindelser
<BillyConnectButton /> // OAuth flow starter
<DineroConnectButton /> // OAuth flow starter
<SyncCustomersModal /> // Import/export dialog
<SyncLogTable /> // Historik over syncs
<ConflictResolution /> // Når samme kunde findes begge steder
```

**Implementation Flow:**

**1. Connect Flow:**
```
1. Bruger går til /dashboard/integrations
2. Klikker "Forbind Billy" eller "Forbind Dinero"
3. Redirect til Billy/Dinero OAuth side
4. Bruger logger ind og godkender
5. Callback til /api/integrations/billy/callback
6. Gem access_token og refresh_token i database
7. Redirect tilbage til integrations side med success message
```

**2. Sync Customers Flow (Import):**
```
1. Bruger klikker "Synkroniser Kunder" → "Importer fra Billy"
2. API henter alle customers fra Billy
3. For hver Billy customer:
   a. Check om customer findes i TimeTrack (via billy_id)
   b. Hvis ikke: Opret ny kunde med billy_id
   c. Hvis ja: Opdater kunde-data (valgfrit)
4. Vis resultat: "Importeret 15 kunder, 3 opdateret, 2 fejlet"
5. Gem sync log entry
```

**3. Sync Invoices Flow (Export):**
```
1. Bruger opretter faktura i TimeTrack
2. Hvis Billy integration er aktiv og "Auto-sync" enabled:
   a. Opret invoice i Billy API
   b. Gem billy_invoice_id i TimeTrack
3. Webhook fra Billy når faktura betales:
   a. Opdater invoice status til 'paid' i TimeTrack
   b. Opdater payment_date
```

**Webhook Setup:**
```typescript
// POST /api/integrations/billy/webhook
// Payload: { event: 'invoice.paid', invoiceId: '...' }

export async function POST(request: Request) {
  const { event, invoiceId } = await request.json();

  if (event === "invoice.paid") {
    // Find invoice med billy_id
    const invoice = await db.query.invoices.findFirst({
      where: eq(invoices.billyId, invoiceId),
    });

    if (invoice) {
      // Opdater status
      await db
        .update(invoices)
        .set({
          status: "paid",
          paidAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id));
    }
  }

  return new Response("OK", { status: 200 });
}
```

---

### 5. Fakturering System (Basis)

**Status:** 📅 Planlagt (Høj prioritet)

**User Story:**
> Som freelancer vil jeg kunne generere fakturaer baseret på mine ikke-fakturerede timer og klippekort-salg, så jeg kan sende fakturaer til mine kunder og holde styr på betalinger.

**Acceptance Criteria:**
- [ ] Fakturaer liste side viser alle fakturaer med status (Kladde, Sendt, Betalt, Forfalden)
- [ ] "Opret Faktura" flow med valg af kunde
- [ ] Auto-select af ikke-fakturerede timer for valgte kunde
- [ ] Auto-select af solgte klippekort (hvis relevant)
- [ ] Manuel tilføjelse af linjer (produkt, beskrivelse, antal, pris)
- [ ] Auto-beregning: Subtotal, moms (25%), total
- [ ] Fakturaindstillinger: Fakturanummer (auto), dato, forfaldsdato, betalingsbetingelser
- [ ] Preview af faktura før afsendelse (PDF format)
- [ ] Send faktura via email direkte fra systemet
- [ ] Download faktura som PDF
- [ ] Markér faktura som betalt manuelt
- [ ] Når faktura betales: Markér alle tilknyttede timer som "faktureret"

**Teknisk Specifikation:**

```typescript
// Database Schema
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft', // 'draft', 'sent', 'paid', 'overdue', 'cancelled'
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  payment_terms VARCHAR(100), // e.g. "Net 30"

  subtotal DECIMAL(10,2) NOT NULL,
  vat_rate DECIMAL(5,2) DEFAULT 25.00,
  vat_amount DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,

  notes TEXT,

  sent_at TIMESTAMP,
  paid_at TIMESTAMP,

  billy_id VARCHAR(255),
  dinero_id VARCHAR(255),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, invoice_number)
);

CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type VARCHAR(50) NOT NULL, // 'time_entry', 'prepaid_package', 'custom'

  description TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,

  time_entry_id UUID REFERENCES time_entries(id),
  prepaid_package_id UUID REFERENCES prepaid_packages(id),

  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);

// Opdater time_entries tabel:
ALTER TABLE time_entries ADD COLUMN is_invoiced BOOLEAN DEFAULT false;
ALTER TABLE time_entries ADD COLUMN invoice_id UUID REFERENCES invoices(id);

// Opdater prepaid_packages tabel:
ALTER TABLE prepaid_packages ADD COLUMN is_invoiced BOOLEAN DEFAULT false;
ALTER TABLE prepaid_packages ADD COLUMN invoice_id UUID REFERENCES invoices(id);

// tRPC Router: invoices
invoices.list(filter?: InvoiceFilter) → Invoice[]
invoices.getById(id: string) → InvoiceWithLines
invoices.create(input: CreateInvoiceInput) → Invoice
invoices.update(id: string, input: UpdateInvoiceInput) → Invoice
invoices.delete(id: string) → { success: boolean }
invoices.markPaid(id: string, paidAt: Date) → Invoice
invoices.send(id: string) → { success: boolean }
invoices.generatePDF(id: string) → { url: string }
invoices.getUnbilledTimeEntries(clientId: string) → TimeEntry[]
invoices.getUnbilledPackages(clientId: string) → PrepaidPackage[]

// TypeScript Types
interface Invoice {
  id: string;
  userId: string;
  clientId: string;
  invoiceNumber: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  issueDate: Date;
  dueDate: Date;
  paymentTerms?: string;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes?: string;
  sentAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface InvoiceLine {
  id: string;
  invoiceId: string;
  lineType: 'time_entry' | 'prepaid_package' | 'custom';
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  timeEntryId?: string;
  prepaidPackageId?: string;
  sortOrder: number;
}

interface CreateInvoiceInput {
  clientId: string;
  issueDate: Date;
  dueDate: Date;
  paymentTerms?: string;
  timeEntryIds?: string[]; // Auto-select ikke-fakturerede timer
  prepaidPackageIds?: string[]; // Auto-select solgte klippekort
  customLines?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  notes?: string;
}

// Routes:
/dashboard/invoices → InvoicesListPage
/dashboard/invoices/new → CreateInvoicePage (wizard)
/dashboard/invoices/[id] → InvoiceDetailPage
/dashboard/invoices/[id]/edit → EditInvoicePage

// API Routes:
/api/invoices/[id]/pdf → Generate PDF
/api/invoices/[id]/send → Send email

// Components:
<InvoicesList /> // Liste med status badges
<InvoiceWizard /> // Multi-step creation flow
  <Step1SelectClient />
  <Step2SelectTimeEntries />
  <Step3SelectPackages />
  <Step4AddCustomLines />
  <Step5Review />
<InvoicePreview /> // PDF preview
<InvoiceStatusBadge /> // Status indikator
<SendInvoiceModal /> // Email send dialog
```

**Invoice Number Generation:**
```typescript
// Auto-generate invoice number: YYYY-NNN
// E.g., 2025-001, 2025-002, etc.

async function generateInvoiceNumber(userId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;

  // Find sidste faktura nummer for året
  const lastInvoice = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.userId, userId),
      like(invoices.invoiceNumber, `${prefix}%`),
    ),
    orderBy: desc(invoices.invoiceNumber),
  });

  let nextNumber = 1;
  if (lastInvoice) {
    const lastNumber = parseInt(lastInvoice.invoiceNumber.split("-")[1]);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(3, "0")}`;
}
```

**PDF Generation:**
```typescript
// Library: @react-pdf/renderer eller puppeteer
// Template: src/lib/pdf/invoice-template.tsx

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const InvoicePDF = ({ invoice, client, lines }: InvoicePDFProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      {/* Header med logo og bruger info */}
      <View style={styles.header}>
        <Text>FAKTURA</Text>
        <Text>{invoice.invoiceNumber}</Text>
      </View>

      {/* Kunde info */}
      <View style={styles.clientInfo}>
        <Text>{client.name}</Text>
        <Text>{client.address}</Text>
      </View>

      {/* Faktura detaljer */}
      <View style={styles.details}>
        <Text>Dato: {formatDate(invoice.issueDate)}</Text>
        <Text>Forfaldsdato: {formatDate(invoice.dueDate)}</Text>
      </View>

      {/* Linjer */}
      <View style={styles.table}>
        {lines.map(line => (
          <View style={styles.row} key={line.id}>
            <Text>{line.description}</Text>
            <Text>{line.quantity}</Text>
            <Text>{line.unitPrice} kr</Text>
            <Text>{line.lineTotal} kr</Text>
          </View>
        ))}
      </View>

      {/* Total */}
      <View style={styles.totals}>
        <Text>Subtotal: {invoice.subtotal} kr</Text>
        <Text>Moms (25%): {invoice.vatAmount} kr</Text>
        <Text>I alt: {invoice.total} kr</Text>
      </View>

      {/* Noter */}
      {invoice.notes && (
        <View style={styles.notes}>
          <Text>{invoice.notes}</Text>
        </View>
      )}
    </Page>
  </Document>
);
```

**Email Sending:**
```typescript
// Library: Resend eller Nodemailer
// Template: src/lib/email/templates/invoice.ts

async function sendInvoiceEmail(invoiceId: string) {
  const invoice = await getInvoiceWithDetails(invoiceId);
  const client = await getClient(invoice.clientId);
  const user = await getUser(invoice.userId);

  // Generer PDF
  const pdfBuffer = await generateInvoicePDF(invoice);

  // Send email
  await resend.emails.send({
    from: `${user.name} <invoices@timetrack.dk>`,
    to: client.email,
    subject: `Faktura ${invoice.invoiceNumber}`,
    html: `
      <p>Hej ${client.name},</p>
      <p>Vedlagt finder du faktura ${invoice.invoiceNumber} på ${invoice.total} kr.</p>
      <p>Betalingsfrist: ${formatDate(invoice.dueDate)}</p>
      <p>Med venlig hilsen,<br>${user.name}</p>
    `,
    attachments: [
      {
        filename: `Faktura-${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  // Opdater invoice status til 'sent'
  await db
    .update(invoices)
    .set({
      status: "sent",
      sentAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId));
}
```

---

### 6. KundeHUB - Kunde Portal (Basis)

**Status:** 📅 Planlagt (Fase 2)

**User Story:**
> Som freelancer vil jeg kunne give mine kunder adgang til en portal hvor de kan se deres projekter, timer og klippekort-saldo, så de har fuld transparens og kan følge med i realtid.

**Acceptance Criteria:**
- [ ] Send invite til kunde via email med invitation link
- [ ] Kunde kan oprette password og logge ind
- [ ] Kunde ser kun egne data (projects, timer, klippekort)
- [ ] Dashboard med oversigt: Aktive projekter, timer denne måned, klippekort-saldo
- [ ] Projektside: Se projekt-detaljer og status
- [ ] Timer side: Liste over registrerede timer med filtrering
- [ ] Klippekort side: Aktive klippekort med saldo og forbrug
- [ ] Download fakturaer (når faktura-system er klar)
- [ ] Kunde kan IKKE redigere noget - kun læse-adgang

**Teknisk Specifikation:**

```typescript
// Database Schema
CREATE TABLE client_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_client_users_client_id ON client_users(client_id);
CREATE INDEX idx_client_invitations_token ON client_invitations(token);

// Routes:
/kundehub/login → Client login page
/kundehub/accept-invite/[token] → Accept invitation
/kundehub/dashboard → Client dashboard
/kundehub/projects → Client projects list
/kundehub/time → Client time entries
/kundehub/klippekort → Client prepaid packages

// tRPC Router: clientPortal (separate fra main router)
clientPortal.login(email, password) → { token: string }
clientPortal.getDashboard() → DashboardData
clientPortal.getProjects() → Project[]
clientPortal.getTimeEntries(filter?) → TimeEntry[]
clientPortal.getPrepaidPackages() → PrepaidPackage[]

// Freelancer actions (main router):
clients.sendPortalInvite(clientId: string) → { success: boolean }
clients.revokePortalAccess(clientId: string) → { success: boolean }

// Components:
<ClientLogin /> // Login form for kunder
<ClientDashboard /> // Oversigt for kunde
<ClientProjects /> // Projekter synlige for kunde
<ClientTimeEntries /> // Timer for kunde (read-only)
<ClientPrepaidPackages /> // Klippekort for kunde

// Email Template:
Subject: Du er inviteret til TimeTrack KundeHUB
Body:
  Hej {client.name},

  {freelancer.name} har inviteret dig til KundeHUB hvor du kan følge med i:
  - Dine projekter
  - Registrerede timer
  - Klippekort-saldo

  Klik her for at aktivere din adgang: {inviteLink}

  Linket udløber om 7 dage.
```

---

## 📊 Implementation Priority

**Umiddelbar prioritet (Fase 1 færdiggør):**
1. ✅ CVR-opslag integration (relativt simpel, stor værdi)
2. ✅ Komplet kundedetaljer side (udbygger eksisterende)
3. ✅ Opgavestyring system (ny funktionalitet, essentiel for workflows)

**Næste prioritet (Fase 2 starter):**
4. ✅ Fakturering system basis (kerneværdi, kompleks men kritisk)
5. ✅ Billy/Dinero integration (dansk marked differentiation)
6. ⭐ KundeHUB portal (differentiation, customer delight)

---

**Senest opdateret:** 2025-01-06

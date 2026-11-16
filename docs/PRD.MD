Freelance CRM - Product Requirements Document (PRD)
📋 Executive Summary
Project Name: TimeTrack CRM
Version: 1.0
Target Users: Freelancers og små konsulentvirksomheder
Primary Goal: Erstatte Effihub med et moderne, stabilt CRM system til freelance work management

🎯 Product Vision
At skabe det mest intuitive og effektive CRM system til freelancere, der kombinerer klienthåndtering, projektstyring, tidstracking og fakturering i én sammenhængende platform.

👥 Target Audience
Primary Users:

Danske freelancere (udviklere, designere, konsulenter)
Små konsulentvirksomheder (1-5 ansatte)
Digitale nomader der skal håndtere internationale klienter
Secondary Users:

Klienter der skal have adgang til projektstatusser
Bogholdere der skal eksportere data til Billy/Dinero
🚀 Core Features - Phase 1 (MVP)
1. Authentication & User Management
   Priority: Critical
   Description: Sikker login og brugerregistrering

Requirements:

Email/password login med Better-Auth
Password reset funktionalitet
User profile management
Session management (7 dages sessions)
Acceptance Criteria:

User kan registrere sig med email/password
User kan logge ind og ud
Sessions udløber automatisk efter 7 dage
Password reset via email
2. Client Management
Priority: Critical
Description: Håndtering af klientinformationer med arkivering og rate management

Requirements:

CRUD operationer på klienter
Klient kontaktinformationer (navn, email, telefon, firma)
Klient-specifikke timepriser (fallback til global rate)
Notesystem for hver klient
Arkivering/deaktivering i stedet for sletning
Filtrering på aktive/arkiverede klienter
Historik over projekter per klient
Søgning og filtering af klienter
Rate Management Logic:

Project Rate → Client Rate → Global Rate (fallback hierarchy)
Acceptance Criteria:

Opret ny klient med alle nødvendige felter
Sæt klient-specifik timepris (optional)
Rediger eksisterende klientdata
Arkiver/deaktiver klienter i stedet for at slette
Vis liste over aktive klienter som standard
Filter mellem aktive/arkiverede klienter
Vis klienthistorik med tilknyttede projekter
Søg i klientnavn/firma/email
3. Project Management
Priority: Critical
Description: Projektstyring tilknyttet klienter

Requirements:

Projekter tilknyttet specifikke klienter
Projektstatus (aktiv, completed, paused)
Timepriser per projekt (hourly rate eller fixed price)
Projektbeskrivelser og noter
Start/slut datoer
Acceptance Criteria:

Opret projekt under en klient
Sæt timepriser (per time eller fast pris)
Ændre projektstatus
Vis projektoversigt med status og priser
Filtrer projekter efter status/klient
4. Time Tracking
Priority: Critical
Description: Registrering af arbejdstimer per projekt med klippekort support

Requirements:

Manuel timeregistrering med dato
Beskrivelse af arbejde udført
Tilknytning til specifikke projekter
Valg mellem normal fakturering eller klippekort
Timepris beregning baseret på projektets rate eller klippekort
Markering af fakturerbar/ikke-fakturerbar tid
Automatisk træk fra klippekort ved valg
Time Entry Flow:

Vælg projekt
Indtast timer og beskrivelse
Vælg betalingsmetode:
Normal billing (bruger projekt/client/global rate)
Klippekort (vælg fra aktive klippekort for klient)
Automatisk beregning og opdatering
Acceptance Criteria:

Registrer timer manuelt med dato og beskrivelse
Vælg mellem normal billing og klippekort
Automatisk beregning af værdi baseret på valgt metode
Automatisk opdatering af klippekort forbrug
Vis timeentries per projekt med betalingsmetode
Rediger/slet eksisterende timeentries
Marker timer som faktureret (kun for non-prepaid)
5. Basic Reporting
Priority: High
Description: Fleksibel håndtering af timepriser med historik

Requirements:

Global default timepris per bruger
Klient-specifikke timepriser (overskriver global)
Projekt-specifikke timepriser (overskriver klient/global)
Historik over alle prisændringer
Årsag til prisændringer (optional)
Effektiv dato for nye priser
Rate Hierarchy:

Project Rate (højeste prioritet)
Client Rate (medium prioritet)
Global Rate (fallback)
Acceptance Criteria:

Sæt global default timepris i bruger indstillinger
Override global rate på klient-niveau
Override klient/global rate på projekt-niveau
Automatisk logging af alle prisændringer
Vis prishistorik per klient/projekt
Vis hvilken rate der bruges til timeberegning
Bulk prisændringer med begrundelse Priority: High
Description: Grundlæggende rapporter til fakturering
Requirements:

Ugentlige/månedlige timerapporter
Revenue oversigt per klient/projekt
Ikke-fakturerede timer oversigt
Eksport til CSV for regnskab
Acceptance Criteria:

Generer rapport for valgt periode
Vis total timer og omsætning
Filter på klient/projekt
Eksporter data til CSV format
🎨 User Experience Requirements
Design Principles
Simplicitet: Ren, minimalistisk interface
Hastighed: Hurtige load times og responsiv navigation
Mobile-first: Optimeret til både desktop og mobil
Accessibility: WCAG 2.1 AA compliant
Key User Flows
1. Daily Time Entry Flow:

Login → Dashboard → View Pending Entries → Quick Approve → OR → Manual Entry → Select Project → Add Description → Save
2. Client Archive/Active Flow:

Clients List → Filter: Active/Archived → Archive Client → Confirm → Updated List
3. Rate Management Flow:

Settings → Default Rate → Client → Override Rate → Project → Override Rate → Time Entry (auto-calculated)
5. Klippekort Management Flow:

Client → Prepaid Packages → Create New → Set Hours & Price → Activate → Time Entry → Select Prepaid → Auto-deduct
6. Recurring Template Setup Flow:

Project → Templates → Create Recurring → Set Frequency → Define Hours & Description → Activate → Auto-generation
7. Weekly Reporting Flow:

Dashboard → Reports → Select Date Range → Choose Client/Project → Generate → Export
📱 Technical Requirements
Performance
Page load times < 2 sekunder
99.9% uptime
Support for 100+ samtidige brugere
Security
HTTPS only
Encrypted database storage
Session-based authentication
GDPR compliant data handling
Browser Support
Chrome/Edge (seneste 2 versioner)
Firefox (seneste 2 versioner)
Safari (seneste 2 versioner)
Mobile browsers (iOS Safari, Chrome Mobile)
API Requirements
RESTful API design via tRPC
TypeScript end-to-end type safety
Rate limiting (100 requests/minute per user)
Comprehensive error handling
🇩🇰 Phase 2: Danish Market Integration (3-6 måneder)
12. Billy/Dinero API Integration
Priority: Critical for Danish market
Description: Seamless integration med Danmarks mest populære regnskabssystemer

Requirements:

Automatisk sync af kund data fra Billy/Dinero
Export af fakturaer direkte til regnskabssystem
Mapping af konti og momssatser
Historisk data import ved onboarding
Real-time status sync (betalt/ubetalt)
Acceptance Criteria:

One-click kunde import fra Billy/Dinero
Automatisk eksport af færdige fakturaer
Mapping interface for kontoplan
Fejlhåndtering og retry logic
Backup export som fallback
13. Danish Compliance Features
Priority: High
Description: Specifikke features til danske freelancere og regler

Requirements:

CVR nummer validering og auto-lookup
Automatisk momshåndtering (25% standard)
SKAT-kompatible rapporter og eksport
MitID integration for enterprise kunder
GDPR-compliant data handling
CVR Integration:

Auto-udfyld firma data ved CVR nummer input
Validering af eksisterende virksomheder
Opdatering ved ændringer i CVR registret
Acceptance Criteria:

CVR lookup via officiel API
Automatisk momstillägg på fakturaer
SKAT-kompatible CSV eksports
GDPR consent management
Data retention policies (7 år regnskabsdata)
14. MobilePay & Payment Integration
Priority: Medium
Description: Integration med danske payment metoder

Requirements:

MobilePay business integration
Payment status tracking
Automatic invoice marking when paid
Payment reminders via SMS/email
Multiple payment methods per client
Acceptance Criteria:

Generate MobilePay payment links
Webhook integration for payment status
Automatic payment reconciliation
Customizable payment reminder intervals
Payment history og reporting
Voice Assistant Integration
"Start timer på projekt X"
"Hvor mange timer har jeg tilbage på klippekort Y?"
"Opret ny klient med navn Z"
Enhanced Mobile Experience
PWA med native app features
Offline-first architecture
Push notifications for klippekort alerts
Voice notes til time entries
Enterprise Team Features
Multi-user support med role-based permissions
Team capacity planning og resource allocation
Advanced projekt collaboration tools
White-label solutions for agencies
Advanced Automation
Blockchain-based time verification for enterprise
Machine learning for optimal pricing recommendations
Predictive cash flow management
Automated contract generation
📊 Success Metrics
Phase 1 KPIs
User registration rate > 80% completion
Daily active users > 70% of registered users
Average session duration > 10 minutter
User retention > 60% efter 30 dage
Business Metrics
Time-to-invoice < 24 timer fra projektafslutning
Reduction in administrative time > 50%
Client satisfaction score > 4.5/5
🗓️ Timeline
Phase 1 (10-12 uger) - MVP med danske essentials
Uge 1-2: Setup, authentication, basic UI
Uge 3-4: Client management + archiving system
Uge 5-6: Project management med rate hierarchy
Uge 7-8: Time tracking + recurring templates
Uge 9-10: Klippekort system + basic client portal
Uge 11-12: Billy/Dinero integration + testing
Phase 2 (6-8 uger) - Differentiation features
Command palette (CMD+K) navigation
AI-powered time suggestions
Advanced dashboard med customizable widgets
CVR integration og SKAT compliance
Mobile PWA optimization
Phase 3 (8-12 uger) - Market leadership
Browser extension for automatic tracking
Workflow automation platform
Advanced business intelligence
Voice assistant integration
Team collaboration features
🔒 Data Model
Core Entities
User (defaultHourlyRate)
├── RateHistory
├── Clients (defaultHourlyRate, isArchived)
│ ├── RateHistory
│ ├── PrepaidPackages (totalHours, usedHours, hourlyRate)
│ │ └── PrepaidUsage (hoursUsed, valueUsed)
│ └── Projects (hourlyRate/fixedPrice)
│ ├── RateHistory
│ ├── RecurringTimeTemplates (frequency, nextDue)
│ │ └── GeneratedTimeEntries (scheduledDate, isCompleted)
│ └── TimeEntries (isPrepaid, isFromTemplate)
├── Invoices
└── Settings
Data Retention
Active data: Unlimited retention
Deleted records: 90 dage soft delete
User account deletion: 30 dage retention for legal purposes
🌍 Localization
Phase 1
Dansk sprog (primary)
DKK som standard valuta
Danske datoformater
Future
Engelsk sprog
Multi-currency support
Timezone handling for internationale klienter
✅ Definition of Done
En feature er færdig når:

All acceptance criteria er opfyldt
Unit tests skrevet og passerer
Responsive design implementeret
TypeScript types er korrekte
Error handling implementeret
Performance requirements opfyldt
Accessibility krav opfyldt
Code review gennemført
🚨 Risk Assessment
High Risk
Database performance ved mange timeentries
Session management kompleksitet
Data migration fra Effihub
Medium Risk
Learning curve for nye teknologier
Third-party API integration (Billy/Dinero)
Mobile app store approval process
Mitigation Strategies
Comprehensive testing strategy
Progressive rollout til beta users
Backup/recovery procedures
Documentation og user guides

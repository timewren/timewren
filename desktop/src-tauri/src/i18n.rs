use std::sync::RwLock;

static CURRENT_LANG: RwLock<String> = RwLock::new(String::new());

pub fn set_language(lang: &str) {
    if let Ok(mut l) = CURRENT_LANG.write() {
        *l = lang.to_string();
    }
}

pub fn get_language() -> String {
    CURRENT_LANG
        .read()
        .map(|l| {
            if l.is_empty() {
                "da".to_string()
            } else {
                l.clone()
            }
        })
        .unwrap_or_else(|_| "da".to_string())
}

/// Get a translated string by key.
/// Returns a `String` because the language is determined at runtime.
pub fn t(key: &str) -> String {
    let lang = get_language();
    match lang.as_str() {
        "en" => t_en(key),
        "sv" => t_sv(key),
        "nb" => t_nb(key),
        "de" => t_de(key),
        "es" => t_es(key),
        _ => t_da(key), // Danish is default/fallback
    }
}

/// Format a translated string with one argument: `t_fmt("key", &[value])`
pub fn t_fmt(key: &str, args: &[&str]) -> String {
    let template = t(key);
    let mut result = template;
    for (i, arg) in args.iter().enumerate() {
        result = result.replace(&format!("{{{}}}", i), arg);
    }
    result
}

fn t_da(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Start timer",
        "tray.pauseTracking" => "Pause tracking",
        "tray.openTimeline" => "Åbn tidslinje",
        "tray.dailyTotal" => "Dagens total: 0t 0m",
        "tray.settings" => "Indstillinger",
        "tray.quit" => "Afslut",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "Kunne ikke oprette HTTP-klient: {0}",
        "error.couldNotParse" => "Kunne ikke parse {0}-svar: {1}",
        "error.noResponseFrom" => "Intet svar fra {0}",
        "error.noTextContent" => "Intet tekstindhold i {0}-svar",
        "error.couldNotParseClassification" => "Kunne ikke parse AI-klassificering: {0}. Rå: {1}",
        "error.apiKeyRequired" => "{0} API-nøgle påkrævet",
        "error.timeout" => "{0} timeout \u{2014} svaret tog for lang tid (>{1} sek)",
        "error.couldNotConnect" => "Kunne ikke forbinde til {0} \u{2014} tjek din internetforbindelse",
        "error.connectionError" => "{0} forbindelsesfejl: {1}",
        "error.apiError" => "{0} API fejl ({1}): {2}",
        "error.connectionOk" => "{0} forbindelse OK (model: {1})",
        "error.unknownAiProvider" => "Ukendt AI-udbyder: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "Sluttidspunktet ligger før starttidspunktet, så varigheden ville blive negativ",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Ollama timeout \u{2014} svaret tog for lang tid (>60 sek). Prøv en mindre model. ({0})",
        "error.ollamaNotRunning" => "Kunne ikke forbinde til Ollama på {0}. Kører Ollama? Start med: ollama serve",
        "error.ollamaModelNotFound" => "Ollama model '{0}' ikke fundet. Kør: ollama pull {1}",
        "error.ollamaError" => "Ollama fejl ({0}): {1}",
        "error.ollamaConnectionOk" => "Ollama forbindelse OK (model: {0}, url: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(Ingen projekter oprettet endnu)",

        // Export CSV headers
        "export.date" => "Dato",
        "export.client" => "Klient",
        "export.project" => "Projekt",
        "export.description" => "Beskrivelse",
        "export.start" => "Start",
        "export.end" => "Slut",
        "export.hours" => "Timer",
        "export.rate" => "Rate",
        "export.amount" => "Beløb",

        // Export/Invoice HTML
        "export.invoice" => "Faktura",
        "export.dueDate" => "Forfaldsdato:",
        "export.billTo" => "Faktureres til",
        "export.descriptionHeader" => "Beskrivelse",
        "export.quantity" => "Antal",
        "export.unitPrice" => "Enhedspris",
        "export.amountHeader" => "Beløb",
        "export.subtotal" => "Subtotal",
        "export.vat" => "Moms ({0}%)",
        "export.total" => "Total",
        "export.notes" => "Noter:",
        "export.paymentInfo" => "Betalingsinfo:",
        "export.invoiceNumber" => "Fakturanr.:",
        "export.invoiceDate" => "Fakturadato:",
        "export.bankPayment" => "Bankoverførsel:",
        "export.bankReg" => "Reg.",
        "export.bankAccount" => "Konto",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Betalingsbetingelser:",
        "export.paymentTermsDays" => "Netto {0} dage",
        "export.printSavePdf" => "Print / Gem som PDF",
        "export.invoiceNotFound" => "Faktura ikke fundet: {0}",

        // Klippekort HTML
        "export.klippekortTitle" => "Klippekort \u{2014} {0}",
        "export.statusActive" => "Aktiv",
        "export.statusExpired" => "Udløbet",
        "export.statusDepleted" => "Opbrugt",
        "export.created" => "Oprettet:",
        "export.expiryDate" => "Udløbsdato:",
        "export.usage" => "Forbrug",
        "export.hoursRemaining" => "Timer tilbage",
        "export.remainingValue" => "Restværdi",
        "export.hourlyRate" => "Timepris",
        "export.registrations" => "Registreringer",
        "export.timeEntries" => "Tidsregistreringer",
        "export.noEntriesYet" => "Ingen tidsregistreringer tilknyttet endnu.",
        "export.totalLabel" => "I alt",
        "export.unknownClient" => "Ukendt klient",
        "export.noExpiry" => "Ingen",
        "export.generatedBy" => "Genereret af TimeTrack Desktop",
        "export.klippekortNotFound" => "Klippekort ikke fundet: {0}",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "Forbrugsrapport",
        "export.usageReportTitle" => "Forbrugsrapport \u{2014} {0}",
        "export.period" => "Periode:",
        "export.hoursUsed" => "Timer brugt",
        "export.totalHoursLabel" => "Timer i alt",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "Momsoverblik",
        "export.vatPeriod" => "Periode",
        "export.vatRate" => "Momssats",
        "export.vatBase" => "Momsgrundlag",
        "export.vatOutgoing" => "Salgsmoms",
        "export.vatInvoiceCount" => "Antal fakturaer",
        "export.vatToReport" => "At indberette (salgsmoms)",

        // Billy
        "billy.connectionFailed" => "Billy API-forbindelse fejlede: {0}",
        "billy.statusError" => "Billy API returnerede status {0}",
        "billy.couldNotParse" => "Kunne ikke parse Billy-svar: {0}",
        "billy.unknownOrg" => "Ukendt organisation",
        "billy.apiFailed" => "Billy API fejlede: {0}",
        "billy.apiStatus" => "Billy API status {0}",
        "billy.couldNotParseResponse" => "Kunne ikke parse svar: {0}",
        "billy.unexpectedResponse" => "Uventet svar fra Billy",
        "billy.noContactInResponse" => "Ingen kontakt i Billy-svar",
        "billy.missingContactId" => "Manglende kontakt-id",
        "billy.missingContactName" => "Manglende kontaktnavn",
        "billy.apiStatusDetail" => "Billy API status {0}: {1}",
        "billy.missingInvoiceId" => "Manglende faktura-id i Billy-svar",
        "billy.invoiceNotFound" => "Faktura ikke fundet: {0}",
        "billy.noInvoiceLines" => "Fakturaen har ingen linjer",

        // Calendar
        "calendar.couldNotFetch" => "Kunne ikke hente kalender: {0}",
        "calendar.urlError" => "Kalender-URL returnerede fejl: {0}",
        "calendar.couldNotRead" => "Kunne ikke læse kalenderdata: {0}",
        "calendar.eventNotFound" => "Kalender-event blev ikke fundet",
        "calendar.eventAlreadyLogged" => "Mødet er allerede registreret",
        "idle.alreadyLogged" => "Perioden er allerede registreret som tid",
        "idle.invalidWindow" => "Ugyldigt tidsrum for pausen",

        // Backup
        "backup.couldNotFindDbPath" => "Kunne ikke finde database-sti: {0}",
        "backup.walCheckpointFailed" => "WAL checkpoint fejlede: {0}",
        "backup.couldNotCreate" => "Kunne ikke oprette backup: {0}",
        "backup.fileNotFound" => "Filen eksisterer ikke",
        "backup.invalidSqlite" => "Filen er ikke en gyldig SQLite-database",
        "backup.invalidTimetrackDb" => "Filen indeholder ikke en gyldig TimeTrack-database",
        "backup.couldNotFindParent" => "Kunne ikke finde overordnet mappe",
        "backup.couldNotCreateSafety" => "Kunne ikke oprette sikkerhedskopi: {0}",
        "backup.couldNotOpenImport" => "Kunne ikke åbne importfilen: {0}",
        "backup.importFailed" => "Importen mislykkedes og intet blev ændret: {0}",
        "backup.noDestination" => "Ingen filvalg — backupen blev ikke gemt",
        "backup.folderNotFound" => "Mappen findes ikke: {0}",
        "backup.wouldOverwriteDatabase" => "Kan ikke gemme backup oveni den database, appen bruger. Vælg en anden mappe.",

        // Sync
        "sync.notLoggedIn" => "Ikke logget ind \u{2014} log ind under Indstillinger \u{2192} Sync",
        "sync.notLoggedInShort" => "Ikke logget ind",
        "sync.connectionError" => "Forbindelsesfejl: {0}",
        "sync.loginFailed" => "Login fejlede ({0}): {1}",
        "sync.invalidServerResponse" => "Ugyldigt svar fra serveren: {0}",
        "sync.sessionExpired" => "Session udløbet \u{2014} log ind igen",
        "sync.pushError" => "Sync push fejl: {0}",
        "sync.pushFailed" => "Push fejlede ({0}): {1}",
        "sync.pushRejectedOne" => "1 ændring kunne ikke sendes: {1}. Den ligger i køen og prøves igen.",
        "sync.pushRejectedMany" => "{0} ændringer kunne ikke sendes: {1}. De ligger i køen og prøves igen.",
        "sync.invalidPushResponse" => "Ugyldigt push-svar: {0}",
        "sync.pullError" => "Sync pull fejl: {0}",
        "sync.pullFailed" => "Pull fejlede ({0}): {1}",
        "sync.invalidPullResponse" => "Ugyldigt pull-svar: {0}",
        "sync.fullSyncError" => "Fuld sync fejl: {0}",
        "sync.fullSyncFailed" => "Fuld sync fejlede ({0}): {1}",
        "sync.clientTooOld" => "Din TimeTrack-app er for gammel \u{2014} opdat\u{00e9}r for at forts\u{00e6}tte. Dine \u{00e6}ndringer ligger sikkert lokalt.",
        "sync.invalidSyncResponse" => "Ugyldigt sync-svar: {0}",
        "sync.couldNotOpenBrowser" => "Kunne ikke åbne browser: {0}",
        "sync.settingsFetchError" => "Hentning af indstillinger fejl: {0}",
        "sync.settingsFetchFailed" => "Indstillinger kunne ikke hentes ({0}): {1}",
        "sync.invalidSettingsResponse" => "Ugyldigt indstillingssvar: {0}",
        "sync.settingsPushError" => "Skrivning af indstillinger fejl: {0}",
        "sync.settingsPushFailed" => "Indstillinger kunne ikke gemmes ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "Klippekort ikke fundet: {0}",
        "autoInvoice.clientNotFound" => "Klient ikke fundet: {0}",
        "autoInvoice.noEntries" => "Ingen tidsregistreringer fundet i den valgte periode",
        "autoInvoice.defaultLineLabel" => "Konsulentarbejde",

        // Browser extension
        "browser.couldNotFindExe" => "Kunne ikke finde programsti: {0}",
        "browser.invalidExePath" => "Ugyldig programsti",
        "browser.couldNotFindAppData" => "Kunne ikke finde app data mappe: {0}",
        "browser.couldNotCreateManifestDir" => "Kunne ikke oprette manifest-mappe: {0}",
        "browser.couldNotRegister" => "Kunne ikke registrere native messaging for nogen browser",
        "browser.registeredFor" => "Registreret for: {0}",
        "browser.couldNotFindHome" => "Kan ikke finde hjemmemappe",
        "browser.couldNotRunReg" => "Kunne ikke køre reg.exe: {0}",
        "browser.registryError" => "Registry-fejl: {0}",

        // License
        "license.couldNotConnectServer" => "Kunne ikke forbinde til licensserveren. Tjek din internetforbindelse. ({0})",
        "license.activationFailed" => "Aktivering fejlede ({0}): {1}",
        "license.invalidResponse" => "Ugyldigt svar fra serveren: {0}",
        "license.unknownError" => "Ukendt fejl",
        "license.couldNotCreateDataDir" => "Kunne ikke oprette datamappen: {0}",
        "license.serializationError" => "Serialiseringsfejl: {0}",
        "license.couldNotSave" => "Kunne ikke gemme licens: {0}",
        "license.couldNotRemove" => "Kunne ikke fjerne licensfil: {0}",
        "license.invalidVerifiedAt" => "Ugyldig verified_at: {0}",
        "license.couldNotFindTrialPath" => "Kunne ikke finde sti til trial-data",
        "license.couldNotSaveTrial" => "Kunne ikke gemme trial-data: {0}",
        "license.registryWriteError" => "Registry write fejl: {0}",
        "license.invalidTrialFormat" => "Ugyldig trial_started_at format: {0}",

        // Health
        "health.dbCorrupt" => "Databasen ser ud til at være beskadiget: {0}",
        "health.couldNotRead" => "Kunne ikke læse fra databasen: {0}",

        // Notification
        "notification.reviewTitle" => "Tid til daglig gennemgang",
        "notification.reviewBody" => "Du har {0} ubekræftede aktiviteter i dag. Klik for at gennemgå dem.",

        // Update
        "update.checkFailed" => "Opdateringstjek fejlede: {0}",
        "update.installFailed" => "Installation af opdatering fejlede: {0}",
        "update.noUpdate" => "Ingen opdatering tilgængelig",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Ugyldigt antal minutter: {0}",

        // Fallback
        _ => return key.to_string(),
    }
    .to_string()
}

fn t_en(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Start timer",
        "tray.pauseTracking" => "Pause tracking",
        "tray.openTimeline" => "Open timeline",
        "tray.dailyTotal" => "Today's total: 0h 0m",
        "tray.settings" => "Settings",
        "tray.quit" => "Quit",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "Could not create HTTP client: {0}",
        "error.couldNotParse" => "Could not parse {0} response: {1}",
        "error.noResponseFrom" => "No response from {0}",
        "error.noTextContent" => "No text content in {0} response",
        "error.couldNotParseClassification" => "Could not parse AI classification: {0}. Raw: {1}",
        "error.apiKeyRequired" => "{0} API key required",
        "error.timeout" => "{0} timeout \u{2014} response took too long (>{1} sec)",
        "error.couldNotConnect" => "Could not connect to {0} \u{2014} check your internet connection",
        "error.connectionError" => "{0} connection error: {1}",
        "error.apiError" => "{0} API error ({1}): {2}",
        "error.connectionOk" => "{0} connection OK (model: {1})",
        "error.unknownAiProvider" => "Unknown AI provider: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "The end time is before the start time, so the duration would be negative",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Ollama timeout \u{2014} response took too long (>60 sec). Try a smaller model. ({0})",
        "error.ollamaNotRunning" => "Could not connect to Ollama at {0}. Is Ollama running? Start with: ollama serve",
        "error.ollamaModelNotFound" => "Ollama model '{0}' not found. Run: ollama pull {1}",
        "error.ollamaError" => "Ollama error ({0}): {1}",
        "error.ollamaConnectionOk" => "Ollama connection OK (model: {0}, url: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(No projects created yet)",

        // Export CSV headers
        "export.date" => "Date",
        "export.client" => "Client",
        "export.project" => "Project",
        "export.description" => "Description",
        "export.start" => "Start",
        "export.end" => "End",
        "export.hours" => "Hours",
        "export.rate" => "Rate",
        "export.amount" => "Amount",

        // Export/Invoice HTML
        "export.invoice" => "Invoice",
        "export.dueDate" => "Due date:",
        "export.billTo" => "Bill to",
        "export.descriptionHeader" => "Description",
        "export.quantity" => "Quantity",
        "export.unitPrice" => "Unit price",
        "export.amountHeader" => "Amount",
        "export.subtotal" => "Subtotal",
        "export.vat" => "VAT ({0}%)",
        "export.total" => "Total",
        "export.notes" => "Notes:",
        "export.paymentInfo" => "Payment info:",
        "export.invoiceNumber" => "Invoice no.:",
        "export.invoiceDate" => "Invoice date:",
        "export.bankPayment" => "Bank transfer:",
        "export.bankReg" => "Reg.",
        "export.bankAccount" => "Account",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Payment terms:",
        "export.paymentTermsDays" => "Net {0} days",
        "export.printSavePdf" => "Print / Save as PDF",
        "export.invoiceNotFound" => "Invoice not found: {0}",

        // Klippekort HTML
        "export.klippekortTitle" => "Prepaid hours \u{2014} {0}",
        "export.statusActive" => "Active",
        "export.statusExpired" => "Expired",
        "export.statusDepleted" => "Depleted",
        "export.created" => "Created:",
        "export.expiryDate" => "Expiry date:",
        "export.usage" => "Usage",
        "export.hoursRemaining" => "Hours remaining",
        "export.remainingValue" => "Remaining value",
        "export.hourlyRate" => "Hourly rate",
        "export.registrations" => "Registrations",
        "export.timeEntries" => "Time entries",
        "export.noEntriesYet" => "No time entries linked yet.",
        "export.totalLabel" => "Total",
        "export.unknownClient" => "Unknown client",
        "export.noExpiry" => "None",
        "export.generatedBy" => "Generated by TimeTrack Desktop",
        "export.klippekortNotFound" => "Prepaid hours package not found: {0}",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "Usage report",
        "export.usageReportTitle" => "Usage report \u{2014} {0}",
        "export.period" => "Period:",
        "export.hoursUsed" => "Hours used",
        "export.totalHoursLabel" => "Total hours",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "VAT overview",
        "export.vatPeriod" => "Period",
        "export.vatRate" => "VAT rate",
        "export.vatBase" => "VAT base",
        "export.vatOutgoing" => "Output VAT",
        "export.vatInvoiceCount" => "Invoice count",
        "export.vatToReport" => "To report (output VAT)",

        // Billy
        "billy.connectionFailed" => "Billy API connection failed: {0}",
        "billy.statusError" => "Billy API returned status {0}",
        "billy.couldNotParse" => "Could not parse Billy response: {0}",
        "billy.unknownOrg" => "Unknown organisation",
        "billy.apiFailed" => "Billy API failed: {0}",
        "billy.apiStatus" => "Billy API status {0}",
        "billy.couldNotParseResponse" => "Could not parse response: {0}",
        "billy.unexpectedResponse" => "Unexpected response from Billy",
        "billy.noContactInResponse" => "No contact in Billy response",
        "billy.missingContactId" => "Missing contact ID",
        "billy.missingContactName" => "Missing contact name",
        "billy.apiStatusDetail" => "Billy API status {0}: {1}",
        "billy.missingInvoiceId" => "Missing invoice ID in Billy response",
        "billy.invoiceNotFound" => "Invoice not found: {0}",
        "billy.noInvoiceLines" => "Invoice has no lines",

        // Calendar
        "calendar.couldNotFetch" => "Could not fetch calendar: {0}",
        "calendar.urlError" => "Calendar URL returned error: {0}",
        "calendar.couldNotRead" => "Could not read calendar data: {0}",
        "calendar.eventNotFound" => "Calendar event not found",
        "calendar.eventAlreadyLogged" => "The meeting is already logged",
        "idle.alreadyLogged" => "This period is already logged as time",
        "idle.invalidWindow" => "Invalid time range for the break",

        // Backup
        "backup.couldNotFindDbPath" => "Could not find database path: {0}",
        "backup.walCheckpointFailed" => "WAL checkpoint failed: {0}",
        "backup.couldNotCreate" => "Could not create backup: {0}",
        "backup.fileNotFound" => "File does not exist",
        "backup.invalidSqlite" => "File is not a valid SQLite database",
        "backup.invalidTimetrackDb" => "File does not contain a valid TimeTrack database",
        "backup.couldNotFindParent" => "Could not find parent directory",
        "backup.couldNotCreateSafety" => "Could not create safety backup: {0}",
        "backup.couldNotOpenImport" => "Could not open import file: {0}",
        "backup.importFailed" => "Import failed and nothing was changed: {0}",
        "backup.noDestination" => "No file chosen — the backup was not saved",
        "backup.folderNotFound" => "Folder not found: {0}",
        "backup.wouldOverwriteDatabase" => "Cannot save the backup over the database the app is using. Choose a different folder.",

        // Sync
        "sync.notLoggedIn" => "Not logged in \u{2014} log in under Settings \u{2192} Sync",
        "sync.notLoggedInShort" => "Not logged in",
        "sync.connectionError" => "Connection error: {0}",
        "sync.loginFailed" => "Login failed ({0}): {1}",
        "sync.invalidServerResponse" => "Invalid server response: {0}",
        "sync.sessionExpired" => "Session expired \u{2014} log in again",
        "sync.pushError" => "Sync push error: {0}",
        "sync.pushFailed" => "Push failed ({0}): {1}",
        "sync.pushRejectedOne" => "1 change could not be sent: {1}. It stays queued and is retried.",
        "sync.pushRejectedMany" => "{0} changes could not be sent: {1}. They stay queued and are retried.",
        "sync.invalidPushResponse" => "Invalid push response: {0}",
        "sync.pullError" => "Sync pull error: {0}",
        "sync.pullFailed" => "Pull failed ({0}): {1}",
        "sync.invalidPullResponse" => "Invalid pull response: {0}",
        "sync.fullSyncError" => "Full sync error: {0}",
        "sync.fullSyncFailed" => "Full sync failed ({0}): {1}",
        "sync.clientTooOld" => "Your TimeTrack app is too old \u{2014} update to continue. Your changes are kept safely on this computer.",
        "sync.invalidSyncResponse" => "Invalid sync response: {0}",
        "sync.couldNotOpenBrowser" => "Could not open browser: {0}",
        "sync.settingsFetchError" => "Settings fetch error: {0}",
        "sync.settingsFetchFailed" => "Could not fetch settings ({0}): {1}",
        "sync.invalidSettingsResponse" => "Invalid settings response: {0}",
        "sync.settingsPushError" => "Settings push error: {0}",
        "sync.settingsPushFailed" => "Could not save settings ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "Prepaid hours package not found: {0}",
        "autoInvoice.clientNotFound" => "Client not found: {0}",
        "autoInvoice.noEntries" => "No time entries found in the selected period",
        "autoInvoice.defaultLineLabel" => "Consulting work",

        // Browser extension
        "browser.couldNotFindExe" => "Could not find executable path: {0}",
        "browser.invalidExePath" => "Invalid executable path",
        "browser.couldNotFindAppData" => "Could not find app data directory: {0}",
        "browser.couldNotCreateManifestDir" => "Could not create manifest directory: {0}",
        "browser.couldNotRegister" => "Could not register native messaging for any browser",
        "browser.registeredFor" => "Registered for: {0}",
        "browser.couldNotFindHome" => "Cannot find home directory",
        "browser.couldNotRunReg" => "Could not run reg.exe: {0}",
        "browser.registryError" => "Registry error: {0}",

        // License
        "license.couldNotConnectServer" => "Could not connect to the license server. Check your internet connection. ({0})",
        "license.activationFailed" => "Activation failed ({0}): {1}",
        "license.invalidResponse" => "Invalid server response: {0}",
        "license.unknownError" => "Unknown error",
        "license.couldNotCreateDataDir" => "Could not create data directory: {0}",
        "license.serializationError" => "Serialization error: {0}",
        "license.couldNotSave" => "Could not save license: {0}",
        "license.couldNotRemove" => "Could not remove license file: {0}",
        "license.invalidVerifiedAt" => "Invalid verified_at: {0}",
        "license.couldNotFindTrialPath" => "Could not find path for trial data",
        "license.couldNotSaveTrial" => "Could not save trial data: {0}",
        "license.registryWriteError" => "Registry write error: {0}",
        "license.invalidTrialFormat" => "Invalid trial_started_at format: {0}",

        // Health
        "health.dbCorrupt" => "Database appears to be corrupted: {0}",
        "health.couldNotRead" => "Could not read from database: {0}",

        // Notification
        "notification.reviewTitle" => "Time for daily review",
        "notification.reviewBody" => "You have {0} unconfirmed activities today. Click to review them.",

        // Update
        "update.checkFailed" => "Update check failed: {0}",
        "update.installFailed" => "Update install failed: {0}",
        "update.noUpdate" => "No update available",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Invalid number of minutes: {0}",

        // Fallback
        _ => return t_da(key),
    }
    .to_string()
}

fn t_sv(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Starta timer",
        "tray.pauseTracking" => "Pausa sp\u{00e5}rning",
        "tray.openTimeline" => "\u{00d6}ppna tidslinje",
        "tray.dailyTotal" => "Dagens total: 0t 0m",
        "tray.settings" => "Inst\u{00e4}llningar",
        "tray.quit" => "Avsluta",

        // Export CSV headers
        "export.date" => "Datum",
        "export.client" => "Kund",
        "export.project" => "Projekt",
        "export.description" => "Beskrivning",
        "export.start" => "Start",
        "export.end" => "Slut",
        "export.hours" => "Timmar",
        "export.rate" => "Timpris",
        "export.amount" => "Belopp",

        // Export/Invoice HTML
        "export.invoice" => "Faktura",
        "export.dueDate" => "F\u{00f6}rfallodatum:",
        "export.billTo" => "Faktureras till",
        "export.descriptionHeader" => "Beskrivning",
        "export.quantity" => "Antal",
        "export.unitPrice" => "Enhetspris",
        "export.amountHeader" => "Belopp",
        "export.subtotal" => "Delsumma",
        "export.vat" => "Moms ({0}%)",
        "export.total" => "Totalt",
        "export.notes" => "Anteckningar:",
        "export.paymentInfo" => "Betalningsinformation:",
        "export.printSavePdf" => "Skriv ut / Spara som PDF",

        // Klippekort
        "export.klippekortTitle" => "Klippkort \u{2014} {0}",
        "export.statusActive" => "Aktiv",
        "export.statusExpired" => "Utg\u{00e5}ngen",
        "export.statusDepleted" => "F\u{00f6}rbrukad",
        "export.usage" => "F\u{00f6}rbrukning",
        "export.hoursRemaining" => "Timmar kvar",
        "export.remainingValue" => "Restv\u{00e4}rde",
        "export.hourlyRate" => "Timpris",
        "export.registrations" => "Registreringar",
        "export.timeEntries" => "Tidsregistreringar",
        "export.noEntriesYet" => "Inga tidsregistreringar kopplade \u{00e4}nnu.",
        "export.totalLabel" => "Totalt",
        "export.unknownClient" => "Ok\u{00e4}nd kund",
        "export.noExpiry" => "Ingen",
        "export.generatedBy" => "Genererad av TimeTrack Desktop",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "F\u{00f6}rbrukningsrapport",
        "export.usageReportTitle" => "F\u{00f6}rbrukningsrapport \u{2014} {0}",
        "export.period" => "Period:",
        "export.hoursUsed" => "Timmar anv\u{00e4}nda",
        "export.totalHoursLabel" => "Timmar totalt",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "Moms\u{00f6}versikt",
        "export.vatPeriod" => "Period",
        "export.vatRate" => "Momssats",
        "export.vatBase" => "Momsunderlag",
        "export.vatOutgoing" => "Utg\u{00e5}ende moms",
        "export.vatInvoiceCount" => "Antal fakturor",
        "export.vatToReport" => "Att redovisa (utg\u{00e5}ende moms)",

        // Notification
        "notification.reviewTitle" => "Dags f\u{00f6}r daglig genomg\u{00e5}ng",
        "notification.reviewBody" => "Du har {0} obekr\u{00e4}ftade aktiviteter idag. Klicka f\u{00f6}r att granska dem.",

        // Auto-invoice
        "autoInvoice.defaultLineLabel" => "Konsultarbete",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Ogiltigt antal minuter: {0}",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "Kunde inte skapa HTTP-klient: {0}",
        "error.couldNotParse" => "Kunde inte tolka {0}-svar: {1}",
        "error.noResponseFrom" => "Inget svar fr\u{00e5}n {0}",
        "error.noTextContent" => "Inget textinneh\u{00e5}ll i {0}-svar",
        "error.couldNotParseClassification" => "Kunde inte tolka AI-klassificering: {0}. R\u{00e5}: {1}",
        "error.apiKeyRequired" => "{0} API-nyckel kr\u{00e4}vs",
        "error.timeout" => "{0} timeout \u{2014} svaret tog f\u{00f6}r l\u{00e5}ng tid (>{1} sek)",
        "error.couldNotConnect" => "Kunde inte ansluta till {0} \u{2014} kontrollera din internetanslutning",
        "error.connectionError" => "{0} anslutningsfel: {1}",
        "error.apiError" => "{0} API-fel ({1}): {2}",
        "error.connectionOk" => "{0} anslutning OK (modell: {1})",
        "error.unknownAiProvider" => "Ok\u{00e4}nd AI-leverant\u{00f6}r: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "Sluttidpunkten ligger f\u{00f6}re starttidpunkten, s\u{00e5} varaktigheten skulle bli negativ",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Ollama timeout \u{2014} svaret tog f\u{00f6}r l\u{00e5}ng tid (>60 sek). Prova en mindre modell. ({0})",
        "error.ollamaNotRunning" => "Kunde inte ansluta till Ollama p\u{00e5} {0}. K\u{00f6}r Ollama? Starta med: ollama serve",
        "error.ollamaModelNotFound" => "Ollama-modellen '{0}' hittades inte. K\u{00f6}r: ollama pull {1}",
        "error.ollamaError" => "Ollama-fel ({0}): {1}",
        "error.ollamaConnectionOk" => "Ollama-anslutning OK (modell: {0}, url: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(Inga projekt skapade \u{00e4}nnu)",

        // Export/Invoice HTML
        "export.invoiceNumber" => "Fakturanr.:",
        "export.invoiceDate" => "Fakturadatum:",
        "export.bankPayment" => "Bank\u{00f6}verf\u{00f6}ring:",
        "export.bankReg" => "Reg.",
        "export.bankAccount" => "Konto",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Betalningsvillkor:",
        "export.paymentTermsDays" => "Netto {0} dagar",
        "export.invoiceNotFound" => "Fakturan hittades inte: {0}",

        // Klippekort HTML
        "export.created" => "Skapad:",
        "export.expiryDate" => "Utg\u{00e5}ngsdatum:",
        "export.klippekortNotFound" => "Klippekortet hittades inte: {0}",

        // Billy
        "billy.connectionFailed" => "Billy API-anslutning misslyckades: {0}",
        "billy.statusError" => "Billy API returnerade status {0}",
        "billy.couldNotParse" => "Kunde inte tolka Billy-svar: {0}",
        "billy.unknownOrg" => "Ok\u{00e4}nd organisation",
        "billy.apiFailed" => "Billy API misslyckades: {0}",
        "billy.apiStatus" => "Billy API-status {0}",
        "billy.couldNotParseResponse" => "Kunde inte tolka svar: {0}",
        "billy.unexpectedResponse" => "Ov\u{00e4}ntat svar fr\u{00e5}n Billy",
        "billy.noContactInResponse" => "Ingen kontakt i Billy-svaret",
        "billy.missingContactId" => "Kontakt-id saknas",
        "billy.missingContactName" => "Kontaktnamn saknas",
        "billy.apiStatusDetail" => "Billy API-status {0}: {1}",
        "billy.missingInvoiceId" => "Faktura-id saknas i Billy-svaret",
        "billy.invoiceNotFound" => "Fakturan hittades inte: {0}",
        "billy.noInvoiceLines" => "Fakturan har inga rader",

        // Calendar
        "calendar.couldNotFetch" => "Kunde inte h\u{00e4}mta kalender: {0}",
        "calendar.urlError" => "Kalender-URL returnerade fel: {0}",
        "calendar.couldNotRead" => "Kunde inte l\u{00e4}sa kalenderdata: {0}",
        "calendar.eventNotFound" => "Kalenderh\u{00e4}ndelsen hittades inte",
        "calendar.eventAlreadyLogged" => "M\u{00f6}tet \u{00e4}r redan registrerat",

        // Idle (pauser)
        "idle.alreadyLogged" => "Perioden \u{00e4}r redan registrerad som tid",
        "idle.invalidWindow" => "Ogiltigt tidsintervall f\u{00f6}r pausen",

        // Backup
        "backup.couldNotFindDbPath" => "Kunde inte hitta databasv\u{00e4}g: {0}",
        "backup.walCheckpointFailed" => "WAL checkpoint misslyckades: {0}",
        "backup.couldNotCreate" => "Kunde inte skapa backup: {0}",
        "backup.fileNotFound" => "Filen finns inte",
        "backup.invalidSqlite" => "Filen \u{00e4}r inte en giltig SQLite-databas",
        "backup.invalidTimetrackDb" => "Filen inneh\u{00e5}ller inte en giltig TimeTrack-databas",
        "backup.couldNotFindParent" => "Kunde inte hitta \u{00f6}verordnad mapp",
        "backup.couldNotCreateSafety" => "Kunde inte skapa s\u{00e4}kerhetskopia: {0}",
        "backup.couldNotOpenImport" => "Kunde inte \u{00f6}ppna importfilen: {0}",
        "backup.importFailed" => "Importen misslyckades och ingenting \u{00e4}ndrades: {0}",
        "backup.noDestination" => "Ingen fil vald \u{2014} backupen sparades inte",
        "backup.folderNotFound" => "Mappen finns inte: {0}",
        "backup.wouldOverwriteDatabase" => "Kan inte spara backupen ovanp\u{00e5} databasen appen anv\u{00e4}nder. V\u{00e4}lj en annan mapp.",

        // Sync
        "sync.notLoggedIn" => "Inte inloggad \u{2014} logga in under Inst\u{00e4}llningar \u{2192} Synk",
        "sync.notLoggedInShort" => "Inte inloggad",
        "sync.connectionError" => "Anslutningsfel: {0}",
        "sync.loginFailed" => "Inloggningen misslyckades ({0}): {1}",
        "sync.invalidServerResponse" => "Ogiltigt svar fr\u{00e5}n servern: {0}",
        "sync.sessionExpired" => "Sessionen har g\u{00e5}tt ut \u{2014} logga in igen",
        "sync.pushError" => "Fel vid sync-push: {0}",
        "sync.pushFailed" => "Push misslyckades ({0}): {1}",
        "sync.pushRejectedOne" => "1 \u{00e4}ndring kunde inte skickas: {1}. Den ligger i k\u{00f6}n och pr\u{00f6}vas igen.",
        "sync.pushRejectedMany" => "{0} \u{00e4}ndringar kunde inte skickas: {1}. De ligger i k\u{00f6}n och pr\u{00f6}vas igen.",
        "sync.invalidPushResponse" => "Ogiltigt push-svar: {0}",
        "sync.pullError" => "Fel vid sync-pull: {0}",
        "sync.pullFailed" => "Pull misslyckades ({0}): {1}",
        "sync.invalidPullResponse" => "Ogiltigt pull-svar: {0}",
        "sync.fullSyncError" => "Fel vid full synk: {0}",
        "sync.fullSyncFailed" => "Full synk misslyckades ({0}): {1}",
        "sync.clientTooOld" => "Din TimeTrack-app \u{00e4}r f\u{00f6}r gammal \u{2014} uppdatera f\u{00f6}r att forts\u{00e4}tta. Dina \u{00e4}ndringar sparas lokalt.",
        "sync.invalidSyncResponse" => "Ogiltigt sync-svar: {0}",
        "sync.couldNotOpenBrowser" => "Kunde inte \u{00f6}ppna webbl\u{00e4}saren: {0}",
        "sync.settingsFetchError" => "Fel vid h\u{00e4}mtning av inst\u{00e4}llningar: {0}",
        "sync.settingsFetchFailed" => "Inst\u{00e4}llningarna kunde inte h\u{00e4}mtas ({0}): {1}",
        "sync.invalidSettingsResponse" => "Ogiltigt inst\u{00e4}llningssvar: {0}",
        "sync.settingsPushError" => "Fel vid skrivning av inst\u{00e4}llningar: {0}",
        "sync.settingsPushFailed" => "Inst\u{00e4}llningarna kunde inte sparas ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "Klippekortet hittades inte: {0}",
        "autoInvoice.clientNotFound" => "Kunden hittades inte: {0}",
        "autoInvoice.noEntries" => "Inga tidsregistreringar hittades i den valda perioden",

        // Browser extension
        "browser.couldNotFindExe" => "Kunde inte hitta programs\u{00f6}kv\u{00e4}g: {0}",
        "browser.invalidExePath" => "Ogiltig programs\u{00f6}kv\u{00e4}g",
        "browser.couldNotFindAppData" => "Kunde inte hitta appdatamappen: {0}",
        "browser.couldNotCreateManifestDir" => "Kunde inte skapa manifestmappen: {0}",
        "browser.couldNotRegister" => "Kunde inte registrera native messaging f\u{00f6}r n\u{00e5}gon webbl\u{00e4}sare",
        "browser.registeredFor" => "Registrerad f\u{00f6}r: {0}",
        "browser.couldNotFindHome" => "Kan inte hitta hemmappen",
        "browser.couldNotRunReg" => "Kunde inte k\u{00f6}ra reg.exe: {0}",
        "browser.registryError" => "Registerfel: {0}",

        // License
        "license.couldNotConnectServer" => "Kunde inte ansluta till licensservern. Kontrollera din internetanslutning. ({0})",
        "license.activationFailed" => "Aktivering misslyckades ({0}): {1}",
        "license.invalidResponse" => "Ogiltigt svar fr\u{00e5}n servern: {0}",
        "license.unknownError" => "Ok\u{00e4}nt fel",
        "license.couldNotCreateDataDir" => "Kunde inte skapa datamappen: {0}",
        "license.serializationError" => "Serialiseringsfel: {0}",
        "license.couldNotSave" => "Kunde inte spara licensen: {0}",
        "license.couldNotRemove" => "Kunde inte ta bort licensfilen: {0}",
        "license.invalidVerifiedAt" => "Ogiltigt verified_at: {0}",
        "license.couldNotFindTrialPath" => "Kunde inte hitta s\u{00f6}kv\u{00e4}gen till provperiodens data",
        "license.couldNotSaveTrial" => "Kunde inte spara provperiodens data: {0}",
        "license.registryWriteError" => "Registerfel vid skrivning: {0}",
        "license.invalidTrialFormat" => "Ogiltigt format f\u{00f6}r trial_started_at: {0}",

        // Health
        "health.dbCorrupt" => "Databasen ser ut att vara skadad: {0}",
        "health.couldNotRead" => "Kunde inte l\u{00e4}sa fr\u{00e5}n databasen: {0}",

        // Update
        "update.checkFailed" => "Kontroll av uppdatering misslyckades: {0}",
        "update.installFailed" => "Installation av uppdateringen misslyckades: {0}",
        "update.noUpdate" => "Ingen uppdatering tillg\u{00e4}nglig",
        // Fallback: en nøgle der mangler her er en fejl, ikke en uoversat streng.
        // Dansk er stadig bedre end en rå nøgle foran brugeren — `noegle_paritet`
        // dømmer at tabellen er fuld, så hullet aldrig opstår i det stille.
        _ => return t_da(key),
    }
    .to_string()
}

fn t_nb(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Start timer",
        "tray.pauseTracking" => "Pause sporing",
        "tray.openTimeline" => "\u{00c5}pne tidslinje",
        "tray.dailyTotal" => "Dagens total: 0t 0m",
        "tray.settings" => "Innstillinger",
        "tray.quit" => "Avslutt",

        // Export CSV headers
        "export.date" => "Dato",
        "export.client" => "Kund",
        "export.project" => "Prosjekt",
        "export.description" => "Beskrivelse",
        "export.start" => "Start",
        "export.end" => "Slutt",
        "export.hours" => "Timer",
        "export.rate" => "Timepris",
        "export.amount" => "Bel\u{00f8}p",

        // Export/Invoice HTML
        "export.invoice" => "Faktura",
        "export.dueDate" => "Forfallsdato:",
        "export.billTo" => "Faktureres til",
        "export.descriptionHeader" => "Beskrivelse",
        "export.quantity" => "Antall",
        "export.unitPrice" => "Enhetspris",
        "export.amountHeader" => "Bel\u{00f8}p",
        "export.subtotal" => "Delsum",
        "export.vat" => "MVA ({0}%)",
        "export.total" => "Totalt",
        "export.notes" => "Notater:",
        "export.paymentInfo" => "Betalingsinformasjon:",
        "export.printSavePdf" => "Skriv ut / Lagre som PDF",

        // Klippekort
        "export.klippekortTitle" => "Klippekort \u{2014} {0}",
        "export.statusActive" => "Aktiv",
        "export.statusExpired" => "Utl\u{00f8}pt",
        "export.statusDepleted" => "Oppbrukt",
        "export.usage" => "Forbruk",
        "export.hoursRemaining" => "Timer igjen",
        "export.remainingValue" => "Restverdi",
        "export.hourlyRate" => "Timepris",
        "export.registrations" => "Registreringer",
        "export.timeEntries" => "Tidsregistreringer",
        "export.noEntriesYet" => "Ingen tidsregistreringer tilknyttet enn\u{00e5}.",
        "export.totalLabel" => "Totalt",
        "export.unknownClient" => "Ukjent kund",
        "export.noExpiry" => "Ingen",
        "export.generatedBy" => "Generert av TimeTrack Desktop",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "Forbruksrapport",
        "export.usageReportTitle" => "Forbruksrapport \u{2014} {0}",
        "export.period" => "Periode:",
        "export.hoursUsed" => "Timer brukt",
        "export.totalHoursLabel" => "Timer totalt",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "MVA-oversikt",
        "export.vatPeriod" => "Periode",
        "export.vatRate" => "MVA-sats",
        "export.vatBase" => "MVA-grunnlag",
        "export.vatOutgoing" => "Utg\u{00e5}ende MVA",
        "export.vatInvoiceCount" => "Antall fakturaer",
        "export.vatToReport" => "\u{00c5} innberette (utg\u{00e5}ende MVA)",

        // Notification
        "notification.reviewTitle" => "Tid for daglig gjennomgang",
        "notification.reviewBody" => "Du har {0} ubekreftede aktiviteter i dag. Klikk for \u{00e5} se gjennom dem.",

        // Auto-invoice
        "autoInvoice.defaultLineLabel" => "Konsulentarbeid",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Ugyldig antall minutter: {0}",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "Kunne ikke opprette HTTP-klient: {0}",
        "error.couldNotParse" => "Kunne ikke tolke {0}-svar: {1}",
        "error.noResponseFrom" => "Ingen svar fra {0}",
        "error.noTextContent" => "Ingen tekstinnhold i {0}-svar",
        "error.couldNotParseClassification" => "Kunne ikke tolke AI-klassifisering: {0}. R\u{00e5}: {1}",
        "error.apiKeyRequired" => "{0} API-n\u{00f8}kkel kreves",
        "error.timeout" => "{0} timeout \u{2014} svaret tok for lang tid (>{1} sek)",
        "error.couldNotConnect" => "Kunne ikke koble til {0} \u{2014} sjekk internettforbindelsen din",
        "error.connectionError" => "{0} tilkoblingsfeil: {1}",
        "error.apiError" => "{0} API-feil ({1}): {2}",
        "error.connectionOk" => "{0} tilkobling OK (modell: {1})",
        "error.unknownAiProvider" => "Ukjent AI-leverand\u{00f8}r: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "Sluttidspunktet ligger f\u{00f8}r starttidspunktet, s\u{00e5} varigheten ville blitt negativ",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Ollama timeout \u{2014} svaret tok for lang tid (>60 sek). Pr\u{00f8}v en mindre modell. ({0})",
        "error.ollamaNotRunning" => "Kunne ikke koble til Ollama p\u{00e5} {0}. Kj\u{00f8}rer Ollama? Start med: ollama serve",
        "error.ollamaModelNotFound" => "Ollama-modellen '{0}' ble ikke funnet. Kj\u{00f8}r: ollama pull {1}",
        "error.ollamaError" => "Ollama-feil ({0}): {1}",
        "error.ollamaConnectionOk" => "Ollama-tilkobling OK (modell: {0}, url: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(Ingen prosjekter opprettet enn\u{00e5})",

        // Export/Invoice HTML
        "export.invoiceNumber" => "Fakturanr.:",
        "export.invoiceDate" => "Fakturadato:",
        "export.bankPayment" => "Bankoverf\u{00f8}ring:",
        "export.bankReg" => "Reg.",
        "export.bankAccount" => "Konto",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Betalingsvilk\u{00e5}r:",
        "export.paymentTermsDays" => "Netto {0} dager",
        "export.invoiceNotFound" => "Fakturaen ble ikke funnet: {0}",

        // Klippekort HTML
        "export.created" => "Opprettet:",
        "export.expiryDate" => "Utl\u{00f8}psdato:",
        "export.klippekortNotFound" => "Klippekortet ble ikke funnet: {0}",

        // Billy
        "billy.connectionFailed" => "Billy API-tilkobling mislyktes: {0}",
        "billy.statusError" => "Billy API returnerte status {0}",
        "billy.couldNotParse" => "Kunne ikke tolke Billy-svar: {0}",
        "billy.unknownOrg" => "Ukjent organisasjon",
        "billy.apiFailed" => "Billy API mislyktes: {0}",
        "billy.apiStatus" => "Billy API-status {0}",
        "billy.couldNotParseResponse" => "Kunne ikke tolke svar: {0}",
        "billy.unexpectedResponse" => "Uventet svar fra Billy",
        "billy.noContactInResponse" => "Ingen kontakt i Billy-svaret",
        "billy.missingContactId" => "Manglende kontakt-id",
        "billy.missingContactName" => "Manglende kontaktnavn",
        "billy.apiStatusDetail" => "Billy API-status {0}: {1}",
        "billy.missingInvoiceId" => "Manglende faktura-id i Billy-svaret",
        "billy.invoiceNotFound" => "Fakturaen ble ikke funnet: {0}",
        "billy.noInvoiceLines" => "Fakturaen har ingen linjer",

        // Calendar
        "calendar.couldNotFetch" => "Kunne ikke hente kalender: {0}",
        "calendar.urlError" => "Kalender-URL returnerte feil: {0}",
        "calendar.couldNotRead" => "Kunne ikke lese kalenderdata: {0}",
        "calendar.eventNotFound" => "Kalenderhendelsen ble ikke funnet",
        "calendar.eventAlreadyLogged" => "M\u{00f8}tet er allerede registrert",

        // Idle (pauser)
        "idle.alreadyLogged" => "Perioden er allerede registrert som tid",
        "idle.invalidWindow" => "Ugyldig tidsrom for pausen",

        // Backup
        "backup.couldNotFindDbPath" => "Kunne ikke finne databasevei: {0}",
        "backup.walCheckpointFailed" => "WAL checkpoint mislyktes: {0}",
        "backup.couldNotCreate" => "Kunne ikke opprette backup: {0}",
        "backup.fileNotFound" => "Filen finnes ikke",
        "backup.invalidSqlite" => "Filen er ikke en gyldig SQLite-database",
        "backup.invalidTimetrackDb" => "Filen inneholder ikke en gyldig TimeTrack-database",
        "backup.couldNotFindParent" => "Kunne ikke finne overordnet mappe",
        "backup.couldNotCreateSafety" => "Kunne ikke opprette sikkerhetskopi: {0}",
        "backup.couldNotOpenImport" => "Kunne ikke \u{00e5}pne importfilen: {0}",
        "backup.importFailed" => "Importen mislyktes og ingenting ble endret: {0}",
        "backup.noDestination" => "Ingen fil ble valgt \u{2014} backupen ble ikke lagret",
        "backup.folderNotFound" => "Mappen finnes ikke: {0}",
        "backup.wouldOverwriteDatabase" => "Kan ikke lagre backupen opp\u{00e5} databasen appen bruker. Velg en annen mappe.",

        // Sync
        "sync.notLoggedIn" => "Ikke logget inn \u{2014} logg inn under Innstillinger \u{2192} Synk",
        "sync.notLoggedInShort" => "Ikke logget inn",
        "sync.connectionError" => "Tilkoblingsfeil: {0}",
        "sync.loginFailed" => "Innloggingen mislyktes ({0}): {1}",
        "sync.invalidServerResponse" => "Ugyldig svar fra serveren: {0}",
        "sync.sessionExpired" => "\u{00d8}kten er utl\u{00f8}pt \u{2014} logg inn igjen",
        "sync.pushError" => "Feil ved sync-push: {0}",
        "sync.pushFailed" => "Push mislyktes ({0}): {1}",
        "sync.pushRejectedOne" => "1 endring kunne ikke sendes: {1}. Den ligger i k\u{00f8}en og pr\u{00f8}ves igjen.",
        "sync.pushRejectedMany" => "{0} endringer kunne ikke sendes: {1}. De ligger i k\u{00f8}en og pr\u{00f8}ves igjen.",
        "sync.invalidPushResponse" => "Ugyldig push-svar: {0}",
        "sync.pullError" => "Feil ved sync-pull: {0}",
        "sync.pullFailed" => "Pull mislyktes ({0}): {1}",
        "sync.invalidPullResponse" => "Ugyldig pull-svar: {0}",
        "sync.fullSyncError" => "Feil ved full synk: {0}",
        "sync.fullSyncFailed" => "Full synk mislyktes ({0}): {1}",
        "sync.clientTooOld" => "TimeTrack-appen din er for gammel \u{2014} oppdater for \u{00e5} fortsette. Endringene dine er trygt lagret lokalt.",
        "sync.invalidSyncResponse" => "Ugyldig sync-svar: {0}",
        "sync.couldNotOpenBrowser" => "Kunne ikke \u{00e5}pne nettleseren: {0}",
        "sync.settingsFetchError" => "Feil ved henting av innstillinger: {0}",
        "sync.settingsFetchFailed" => "Innstillingene kunne ikke hentes ({0}): {1}",
        "sync.invalidSettingsResponse" => "Ugyldig innstillingssvar: {0}",
        "sync.settingsPushError" => "Feil ved skriving av innstillinger: {0}",
        "sync.settingsPushFailed" => "Innstillingene kunne ikke lagres ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "Klippekortet ble ikke funnet: {0}",
        "autoInvoice.clientNotFound" => "Kunden ble ikke funnet: {0}",
        "autoInvoice.noEntries" => "Ingen tidsregistreringer funnet i den valgte perioden",

        // Browser extension
        "browser.couldNotFindExe" => "Kunne ikke finne programstien: {0}",
        "browser.invalidExePath" => "Ugyldig programsti",
        "browser.couldNotFindAppData" => "Kunne ikke finne appdatamappen: {0}",
        "browser.couldNotCreateManifestDir" => "Kunne ikke opprette manifestmappen: {0}",
        "browser.couldNotRegister" => "Kunne ikke registrere native messaging for noen nettleser",
        "browser.registeredFor" => "Registrert for: {0}",
        "browser.couldNotFindHome" => "Kan ikke finne hjemmemappen",
        "browser.couldNotRunReg" => "Kunne ikke kj\u{00f8}re reg.exe: {0}",
        "browser.registryError" => "Registerfeil: {0}",

        // License
        "license.couldNotConnectServer" => "Kunne ikke koble til lisensserveren. Sjekk internettforbindelsen din. ({0})",
        "license.activationFailed" => "Aktivering mislyktes ({0}): {1}",
        "license.invalidResponse" => "Ugyldig svar fra serveren: {0}",
        "license.unknownError" => "Ukjent feil",
        "license.couldNotCreateDataDir" => "Kunne ikke opprette datamappen: {0}",
        "license.serializationError" => "Serialiseringsfeil: {0}",
        "license.couldNotSave" => "Kunne ikke lagre lisensen: {0}",
        "license.couldNotRemove" => "Kunne ikke fjerne lisensfilen: {0}",
        "license.invalidVerifiedAt" => "Ugyldig verified_at: {0}",
        "license.couldNotFindTrialPath" => "Kunne ikke finne stien til data for pr\u{00f8}veperioden",
        "license.couldNotSaveTrial" => "Kunne ikke lagre data for pr\u{00f8}veperioden: {0}",
        "license.registryWriteError" => "Registerfeil ved skriving: {0}",
        "license.invalidTrialFormat" => "Ugyldig format for trial_started_at: {0}",

        // Health
        "health.dbCorrupt" => "Databasen ser ut til \u{00e5} v\u{00e6}re skadet: {0}",
        "health.couldNotRead" => "Kunne ikke lese fra databasen: {0}",

        // Update
        "update.checkFailed" => "Sjekk etter oppdatering mislyktes: {0}",
        "update.installFailed" => "Installasjon av oppdateringen mislyktes: {0}",
        "update.noUpdate" => "Ingen oppdatering tilgjengelig",
        // Fallback: en nøgle der mangler her er en fejl, ikke en uoversat streng.
        // Dansk er stadig bedre end en rå nøgle foran brugeren — `noegle_paritet`
        // dømmer at tabellen er fuld, så hullet aldrig opstår i det stille.
        _ => return t_da(key),
    }
    .to_string()
}

fn t_de(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Timer starten",
        "tray.pauseTracking" => "Tracking pausieren",
        "tray.openTimeline" => "Zeitleiste \u{00f6}ffnen",
        "tray.dailyTotal" => "Heutiges Total: 0h 0m",
        "tray.settings" => "Einstellungen",
        "tray.quit" => "Beenden",

        // Export CSV headers
        "export.date" => "Datum",
        "export.client" => "Kunde",
        "export.project" => "Projekt",
        "export.description" => "Beschreibung",
        "export.start" => "Start",
        "export.end" => "Ende",
        "export.hours" => "Stunden",
        "export.rate" => "Stundensatz",
        "export.amount" => "Betrag",

        // Export/Invoice HTML
        "export.invoice" => "Rechnung",
        "export.dueDate" => "F\u{00e4}lligkeitsdatum:",
        "export.billTo" => "Rechnung an",
        "export.descriptionHeader" => "Beschreibung",
        "export.quantity" => "Menge",
        "export.unitPrice" => "Einzelpreis",
        "export.amountHeader" => "Betrag",
        "export.subtotal" => "Zwischensumme",
        "export.vat" => "MwSt. ({0}%)",
        "export.total" => "Gesamt",
        "export.notes" => "Anmerkungen:",
        "export.paymentInfo" => "Zahlungsinformationen:",
        "export.printSavePdf" => "Drucken / Als PDF speichern",

        // Klippekort
        "export.klippekortTitle" => "Stundenkontingent \u{2014} {0}",
        "export.statusActive" => "Aktiv",
        "export.statusExpired" => "Abgelaufen",
        "export.statusDepleted" => "Aufgebraucht",
        "export.usage" => "Verbrauch",
        "export.hoursRemaining" => "Stunden verbleibend",
        "export.remainingValue" => "Restwert",
        "export.hourlyRate" => "Stundensatz",
        "export.registrations" => "Registrierungen",
        "export.timeEntries" => "Zeiteintr\u{00e4}ge",
        "export.noEntriesYet" => "Noch keine Zeiteintr\u{00e4}ge zugeordnet.",
        "export.totalLabel" => "Gesamt",
        "export.unknownClient" => "Unbekannter Kunde",
        "export.noExpiry" => "Kein",
        "export.generatedBy" => "Erstellt mit TimeTrack Desktop",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "Verbrauchsbericht",
        "export.usageReportTitle" => "Verbrauchsbericht \u{2014} {0}",
        "export.period" => "Zeitraum:",
        "export.hoursUsed" => "Verbrauchte Stunden",
        "export.totalHoursLabel" => "Stunden gesamt",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "USt-\u{00dc}bersicht",
        "export.vatPeriod" => "Zeitraum",
        "export.vatRate" => "USt-Satz",
        "export.vatBase" => "USt-Bemessungsgrundlage",
        "export.vatOutgoing" => "Ausgangsumsatzsteuer",
        "export.vatInvoiceCount" => "Anzahl Rechnungen",
        "export.vatToReport" => "Zu melden (Ausgangs-USt)",

        // Notification
        "notification.reviewTitle" => "Zeit f\u{00fc}r die t\u{00e4}gliche \u{00dc}berpr\u{00fc}fung",
        "notification.reviewBody" => "Sie haben {0} unbest\u{00e4}tigte Aktivit\u{00e4}ten heute. Klicken Sie, um sie zu \u{00fc}berpr\u{00fc}fen.",

        // Auto-invoice
        "autoInvoice.defaultLineLabel" => "Beratungsarbeit",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Ungültige Anzahl Minuten: {0}",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "HTTP-Client konnte nicht erstellt werden: {0}",
        "error.couldNotParse" => "Antwort von {0} konnte nicht ausgewertet werden: {1}",
        "error.noResponseFrom" => "Keine Antwort von {0}",
        "error.noTextContent" => "Kein Textinhalt in der Antwort von {0}",
        "error.couldNotParseClassification" => "KI-Klassifizierung konnte nicht ausgewertet werden: {0}. Roh: {1}",
        "error.apiKeyRequired" => "{0} API-Schl\u{00fc}ssel erforderlich",
        "error.timeout" => "{0} Zeit\u{00fc}berschreitung \u{2014} die Antwort hat zu lange gebraucht (>{1} Sek.)",
        "error.couldNotConnect" => "Verbindung zu {0} fehlgeschlagen \u{2014} pr\u{00fc}fen Sie Ihre Internetverbindung",
        "error.connectionError" => "{0} Verbindungsfehler: {1}",
        "error.apiError" => "{0} API-Fehler ({1}): {2}",
        "error.connectionOk" => "{0} Verbindung OK (Modell: {1})",
        "error.unknownAiProvider" => "Unbekannter KI-Anbieter: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "Der Endzeitpunkt liegt vor dem Startzeitpunkt, die Dauer w\u{00e4}re also negativ",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Ollama Zeit\u{00fc}berschreitung \u{2014} die Antwort hat zu lange gebraucht (>60 Sek.). Probiere ein kleineres Modell. ({0})",
        "error.ollamaNotRunning" => "Verbindung zu Ollama unter {0} fehlgeschlagen. L\u{00e4}uft Ollama? Starten Sie mit: ollama serve",
        "error.ollamaModelNotFound" => "Ollama-Modell '{0}' nicht gefunden. F\u{00fc}hren Sie aus: ollama pull {1}",
        "error.ollamaError" => "Ollama-Fehler ({0}): {1}",
        "error.ollamaConnectionOk" => "Ollama-Verbindung OK (Modell: {0}, URL: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(Noch keine Projekte angelegt)",

        // Export/Invoice HTML
        "export.invoiceNumber" => "Rechnungsnr.:",
        "export.invoiceDate" => "Rechnungsdatum:",
        "export.bankPayment" => "Bank\u{00fc}berweisung:",
        "export.bankReg" => "Reg.",
        "export.bankAccount" => "Konto",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Zahlungsbedingungen:",
        "export.paymentTermsDays" => "Netto {0} Tage",
        "export.invoiceNotFound" => "Rechnung nicht gefunden: {0}",

        // Klippekort HTML
        "export.created" => "Erstellt:",
        "export.expiryDate" => "Ablaufdatum:",
        "export.klippekortNotFound" => "Stundenkontingent nicht gefunden: {0}",

        // Billy
        "billy.connectionFailed" => "Verbindung zur Billy-API fehlgeschlagen: {0}",
        "billy.statusError" => "Die Billy-API hat Status {0} zur\u{00fc}ckgegeben",
        "billy.couldNotParse" => "Billy-Antwort konnte nicht ausgewertet werden: {0}",
        "billy.unknownOrg" => "Unbekannte Organisation",
        "billy.apiFailed" => "Die Billy-API ist fehlgeschlagen: {0}",
        "billy.apiStatus" => "Billy-API-Status {0}",
        "billy.couldNotParseResponse" => "Antwort konnte nicht ausgewertet werden: {0}",
        "billy.unexpectedResponse" => "Unerwartete Antwort von Billy",
        "billy.noContactInResponse" => "Kein Kontakt in der Billy-Antwort",
        "billy.missingContactId" => "Fehlende Kontakt-ID",
        "billy.missingContactName" => "Fehlender Kontaktname",
        "billy.apiStatusDetail" => "Billy-API-Status {0}: {1}",
        "billy.missingInvoiceId" => "Fehlende Rechnungs-ID in der Billy-Antwort",
        "billy.invoiceNotFound" => "Rechnung nicht gefunden: {0}",
        "billy.noInvoiceLines" => "Die Rechnung hat keine Positionen",

        // Calendar
        "calendar.couldNotFetch" => "Kalender konnte nicht abgerufen werden: {0}",
        "calendar.urlError" => "Die Kalender-URL hat einen Fehler zur\u{00fc}ckgegeben: {0}",
        "calendar.couldNotRead" => "Kalenderdaten konnten nicht gelesen werden: {0}",
        "calendar.eventNotFound" => "Kalendereintrag nicht gefunden",
        "calendar.eventAlreadyLogged" => "Das Meeting ist bereits erfasst",

        // Idle (pauser)
        "idle.alreadyLogged" => "Der Zeitraum ist bereits als Arbeitszeit erfasst",
        "idle.invalidWindow" => "Ung\u{00fc}ltiger Zeitraum f\u{00fc}r die Pause",

        // Backup
        "backup.couldNotFindDbPath" => "Datenbankpfad nicht gefunden: {0}",
        "backup.walCheckpointFailed" => "WAL-Checkpoint fehlgeschlagen: {0}",
        "backup.couldNotCreate" => "Backup konnte nicht erstellt werden: {0}",
        "backup.fileNotFound" => "Die Datei existiert nicht",
        "backup.invalidSqlite" => "Die Datei ist keine g\u{00fc}ltige SQLite-Datenbank",
        "backup.invalidTimetrackDb" => "Die Datei enth\u{00e4}lt keine g\u{00fc}ltige TimeTrack-Datenbank",
        "backup.couldNotFindParent" => "\u{00dc}bergeordneter Ordner nicht gefunden",
        "backup.couldNotCreateSafety" => "Sicherheitskopie konnte nicht erstellt werden: {0}",
        "backup.couldNotOpenImport" => "Importdatei konnte nicht ge\u{00f6}ffnet werden: {0}",
        "backup.importFailed" => "Der Import ist fehlgeschlagen, es wurde nichts ge\u{00e4}ndert: {0}",
        "backup.noDestination" => "Keine Datei ausgew\u{00e4}hlt \u{2014} das Backup wurde nicht gespeichert",
        "backup.folderNotFound" => "Der Ordner existiert nicht: {0}",
        "backup.wouldOverwriteDatabase" => "Das Backup kann nicht \u{00fc}ber die verwendete Datenbank gelegt werden. W\u{00e4}hlen Sie einen anderen Ordner.",

        // Sync
        "sync.notLoggedIn" => "Nicht angemeldet \u{2014} unter Einstellungen \u{2192} Sync anmelden",
        "sync.notLoggedInShort" => "Nicht angemeldet",
        "sync.connectionError" => "Verbindungsfehler: {0}",
        "sync.loginFailed" => "Anmeldung fehlgeschlagen ({0}): {1}",
        "sync.invalidServerResponse" => "Ung\u{00fc}ltige Antwort vom Server: {0}",
        "sync.sessionExpired" => "Sitzung abgelaufen \u{2014} bitte erneut anmelden",
        "sync.pushError" => "Fehler beim Sync-Push: {0}",
        "sync.pushFailed" => "Push fehlgeschlagen ({0}): {1}",
        "sync.pushRejectedOne" => "1 \u{00c4}nderung konnte nicht gesendet werden: {1}. Sie bleibt in der Warteschlange und wird erneut versucht.",
        "sync.pushRejectedMany" => "{0} \u{00c4}nderungen konnten nicht gesendet werden: {1}. Sie bleiben in der Warteschlange und werden erneut versucht.",
        "sync.invalidPushResponse" => "Ung\u{00fc}ltige Push-Antwort: {0}",
        "sync.pullError" => "Fehler beim Sync-Pull: {0}",
        "sync.pullFailed" => "Pull fehlgeschlagen ({0}): {1}",
        "sync.invalidPullResponse" => "Ung\u{00fc}ltige Pull-Antwort: {0}",
        "sync.fullSyncError" => "Fehler bei der vollst\u{00e4}ndigen Synchronisierung: {0}",
        "sync.fullSyncFailed" => "Vollst\u{00e4}ndige Synchronisierung fehlgeschlagen ({0}): {1}",
        "sync.clientTooOld" => "Ihre TimeTrack-App ist zu alt \u{2014} bitte aktualisieren, um fortzufahren. Ihre \u{00c4}nderungen bleiben lokal gespeichert.",
        "sync.invalidSyncResponse" => "Ung\u{00fc}ltige Sync-Antwort: {0}",
        "sync.couldNotOpenBrowser" => "Browser konnte nicht ge\u{00f6}ffnet werden: {0}",
        "sync.settingsFetchError" => "Fehler beim Abrufen der Einstellungen: {0}",
        "sync.settingsFetchFailed" => "Die Einstellungen konnten nicht abgerufen werden ({0}): {1}",
        "sync.invalidSettingsResponse" => "Ung\u{00fc}ltige Einstellungsantwort: {0}",
        "sync.settingsPushError" => "Fehler beim Speichern der Einstellungen: {0}",
        "sync.settingsPushFailed" => "Die Einstellungen konnten nicht gespeichert werden ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "Stundenkontingent nicht gefunden: {0}",
        "autoInvoice.clientNotFound" => "Kunde nicht gefunden: {0}",
        "autoInvoice.noEntries" => "Im gew\u{00e4}hlten Zeitraum wurden keine Zeiteintr\u{00e4}ge gefunden",

        // Browser extension
        "browser.couldNotFindExe" => "Programmpfad nicht gefunden: {0}",
        "browser.invalidExePath" => "Ung\u{00fc}ltiger Programmpfad",
        "browser.couldNotFindAppData" => "AppData-Ordner nicht gefunden: {0}",
        "browser.couldNotCreateManifestDir" => "Manifest-Ordner konnte nicht erstellt werden: {0}",
        "browser.couldNotRegister" => "Native Messaging konnte f\u{00fc}r keinen Browser registriert werden",
        "browser.registeredFor" => "Registriert f\u{00fc}r: {0}",
        "browser.couldNotFindHome" => "Der Benutzerordner kann nicht gefunden werden",
        "browser.couldNotRunReg" => "reg.exe konnte nicht ausgef\u{00fc}hrt werden: {0}",
        "browser.registryError" => "Registry-Fehler: {0}",

        // License
        "license.couldNotConnectServer" => "Verbindung zum Lizenzserver fehlgeschlagen. Pr\u{00fc}fen Sie Ihre Internetverbindung. ({0})",
        "license.activationFailed" => "Aktivierung fehlgeschlagen ({0}): {1}",
        "license.invalidResponse" => "Ung\u{00fc}ltige Antwort vom Server: {0}",
        "license.unknownError" => "Unbekannter Fehler",
        "license.couldNotCreateDataDir" => "Datenordner konnte nicht erstellt werden: {0}",
        "license.serializationError" => "Serialisierungsfehler: {0}",
        "license.couldNotSave" => "Die Lizenz konnte nicht gespeichert werden: {0}",
        "license.couldNotRemove" => "Die Lizenzdatei konnte nicht entfernt werden: {0}",
        "license.invalidVerifiedAt" => "Ung\u{00fc}ltiges verified_at: {0}",
        "license.couldNotFindTrialPath" => "Pfad zu den Daten der Testversion nicht gefunden",
        "license.couldNotSaveTrial" => "Daten der Testversion konnten nicht gespeichert werden: {0}",
        "license.registryWriteError" => "Registry-Schreibfehler: {0}",
        "license.invalidTrialFormat" => "Ung\u{00fc}ltiges Format f\u{00fc}r trial_started_at: {0}",

        // Health
        "health.dbCorrupt" => "Die Datenbank scheint besch\u{00e4}digt zu sein: {0}",
        "health.couldNotRead" => "Aus der Datenbank konnte nicht gelesen werden: {0}",

        // Update
        "update.checkFailed" => "Update-Pr\u{00fc}fung fehlgeschlagen: {0}",
        "update.installFailed" => "Installation des Updates fehlgeschlagen: {0}",
        "update.noUpdate" => "Kein Update verf\u{00fc}gbar",
        // Fallback: en nøgle der mangler her er en fejl, ikke en uoversat streng.
        // Dansk er stadig bedre end en rå nøgle foran brugeren — `noegle_paritet`
        // dømmer at tabellen er fuld, så hullet aldrig opstår i det stille.
        _ => return t_da(key),
    }
    .to_string()
}

fn t_es(key: &str) -> String {
    match key {
        // Tray
        "tray.startTimer" => "Iniciar temporizador",
        "tray.pauseTracking" => "Pausar el seguimiento",
        "tray.openTimeline" => "Abrir línea de tiempo",
        "tray.dailyTotal" => "Total del día: 0 h 0 min",
        "tray.settings" => "Ajustes",
        "tray.quit" => "Salir",

        // Errors — generic
        "error.couldNotCreateHttpClient" => "No se pudo crear el cliente HTTP: {0}",
        "error.couldNotParse" => "No se pudo interpretar la respuesta de {0}: {1}",
        "error.noResponseFrom" => "Sin respuesta de {0}",
        "error.noTextContent" => "La respuesta de {0} no contiene texto",
        "error.couldNotParseClassification" => "No se pudo interpretar la clasificación de la IA: {0}. Original: {1}",
        "error.apiKeyRequired" => "Se necesita la clave de API de {0}",
        "error.timeout" => "Tiempo de espera agotado en {0}: la respuesta tardó demasiado (>{1} s)",
        "error.couldNotConnect" => "No se pudo conectar con {0}: comprueba tu conexión a internet",
        "error.connectionError" => "Error de conexión con {0}: {1}",
        "error.apiError" => "Error de la API de {0} ({1}): {2}",
        "error.connectionOk" => "Conexión con {0} correcta (modelo: {1})",
        "error.unknownAiProvider" => "Proveedor de IA desconocido: {0}",

        // Time entries
        "timeEntry.endBeforeStart" => "La hora de fin es anterior a la de inicio, así que la duración sería negativa",

        // Ollama-specific
        "error.ollamaTimeoutTrySmaller" => "Tiempo de espera agotado en Ollama: la respuesta tardó demasiado (>60 s). Prueba con un modelo más pequeño. ({0})",
        "error.ollamaNotRunning" => "No se pudo conectar con Ollama en {0}. ¿Está en marcha Ollama? Inícialo con: ollama serve",
        "error.ollamaModelNotFound" => "No se ha encontrado el modelo '{0}' de Ollama. Ejecuta: ollama pull {1}",
        "error.ollamaError" => "Error de Ollama ({0}): {1}",
        "error.ollamaConnectionOk" => "Conexión con Ollama correcta (modelo: {0}, url: {1})",

        // AI prompt
        "ai.noProjectsYet" => "(Todavía no hay proyectos creados)",

        // Export CSV headers
        "export.date" => "Fecha",
        "export.client" => "Cliente",
        "export.project" => "Proyecto",
        "export.description" => "Descripción",
        "export.start" => "Inicio",
        "export.end" => "Fin",
        "export.hours" => "Horas",
        "export.rate" => "Tarifa",
        "export.amount" => "Importe",

        // Export/Invoice HTML
        "export.invoice" => "Factura",
        "export.dueDate" => "Fecha de vencimiento:",
        "export.billTo" => "Facturar a",
        "export.descriptionHeader" => "Descripción",
        "export.quantity" => "Cantidad",
        "export.unitPrice" => "Precio unitario",
        "export.amountHeader" => "Importe",
        "export.subtotal" => "Subtotal",
        "export.vat" => "IVA ({0}%)",
        "export.total" => "Total",
        "export.notes" => "Notas:",
        "export.paymentInfo" => "Datos de pago:",
        "export.invoiceNumber" => "N.º de factura:",
        "export.invoiceDate" => "Fecha de factura:",
        "export.bankPayment" => "Transferencia bancaria:",
        "export.bankReg" => "Sucursal",
        "export.bankAccount" => "Cuenta",
        "export.mobilepay" => "MobilePay:",
        "export.paymentTerms" => "Condiciones de pago:",
        "export.paymentTermsDays" => "Neto {0} días",
        "export.printSavePdf" => "Imprimir / Guardar como PDF",
        "export.invoiceNotFound" => "No se ha encontrado la factura: {0}",

        // Klippekort HTML
        "export.klippekortTitle" => "Bono de horas: {0}",
        "export.statusActive" => "Activo",
        "export.statusExpired" => "Caducado",
        "export.statusDepleted" => "Agotado",
        "export.created" => "Creado:",
        "export.expiryDate" => "Fecha de caducidad:",
        "export.usage" => "Consumo",
        "export.hoursRemaining" => "Horas restantes",
        "export.remainingValue" => "Valor restante",
        "export.hourlyRate" => "Tarifa por hora",
        "export.registrations" => "Registros",
        "export.timeEntries" => "Registros de tiempo",
        "export.noEntriesYet" => "Todavía no hay registros de tiempo asociados.",
        "export.totalLabel" => "Total",
        "export.unknownClient" => "Cliente desconocido",
        "export.noExpiry" => "Ninguna",
        "export.generatedBy" => "Generado por TimeTrack Desktop",
        "export.klippekortNotFound" => "No se ha encontrado el bono de horas: {0}",

        // Klippekort usage report (client-facing)
        "export.usageReport" => "Informe de consumo",
        "export.usageReportTitle" => "Informe de consumo: {0}",
        "export.period" => "Periodo:",
        "export.hoursUsed" => "Horas usadas",
        "export.totalHoursLabel" => "Horas en total",

        // VAT overview (momsoverblik) CSV
        "export.vatOverview" => "Resumen del IVA",
        "export.vatPeriod" => "Periodo",
        "export.vatRate" => "Tipo de IVA",
        "export.vatBase" => "Base imponible",
        "export.vatOutgoing" => "IVA repercutido",
        "export.vatInvoiceCount" => "Número de facturas",
        "export.vatToReport" => "A declarar (IVA repercutido)",

        // Billy
        "billy.connectionFailed" => "Error de conexión con la API de Billy: {0}",
        "billy.statusError" => "La API de Billy devolvió el estado {0}",
        "billy.couldNotParse" => "No se pudo interpretar la respuesta de Billy: {0}",
        "billy.unknownOrg" => "Organización desconocida",
        "billy.apiFailed" => "Error de la API de Billy: {0}",
        "billy.apiStatus" => "Estado de la API de Billy {0}",
        "billy.couldNotParseResponse" => "No se pudo interpretar la respuesta: {0}",
        "billy.unexpectedResponse" => "Respuesta inesperada de Billy",
        "billy.noContactInResponse" => "No hay ningún contacto en la respuesta de Billy",
        "billy.missingContactId" => "Falta el id del contacto",
        "billy.missingContactName" => "Falta el nombre del contacto",
        "billy.apiStatusDetail" => "Estado de la API de Billy {0}: {1}",
        "billy.missingInvoiceId" => "Falta el id de la factura en la respuesta de Billy",
        "billy.invoiceNotFound" => "No se ha encontrado la factura: {0}",
        "billy.noInvoiceLines" => "La factura no tiene líneas",

        // Calendar
        "calendar.couldNotFetch" => "No se pudo obtener el calendario: {0}",
        "calendar.urlError" => "La URL del calendario devolvió un error: {0}",
        "calendar.couldNotRead" => "No se pudieron leer los datos del calendario: {0}",
        "calendar.eventNotFound" => "No se ha encontrado el evento del calendario",
        "calendar.eventAlreadyLogged" => "La reunión ya está registrada",
        "idle.alreadyLogged" => "El periodo ya está registrado como tiempo",
        "idle.invalidWindow" => "Intervalo de tiempo no válido para la pausa",

        // Backup
        "backup.couldNotFindDbPath" => "No se pudo encontrar la ruta de la base de datos: {0}",
        "backup.walCheckpointFailed" => "Error en el checkpoint de WAL: {0}",
        "backup.couldNotCreate" => "No se pudo crear la copia de seguridad: {0}",
        "backup.fileNotFound" => "El archivo no existe",
        "backup.invalidSqlite" => "El archivo no es una base de datos SQLite válida",
        "backup.invalidTimetrackDb" => "El archivo no contiene una base de datos de TimeTrack válida",
        "backup.couldNotFindParent" => "No se pudo encontrar la carpeta superior",
        "backup.couldNotCreateSafety" => "No se pudo crear la copia de seguridad previa: {0}",
        "backup.couldNotOpenImport" => "No se pudo abrir el archivo de importación: {0}",
        "backup.importFailed" => "La importación ha fallado y no se ha cambiado nada: {0}",
        "backup.noDestination" => "No se eligió ningún archivo: la copia de seguridad no se ha guardado",
        "backup.folderNotFound" => "La carpeta no existe: {0}",
        "backup.wouldOverwriteDatabase" => "No se puede guardar la copia de seguridad sobre la base de datos que usa la app. Elige otra carpeta.",

        // Sync
        "sync.notLoggedIn" => "No has iniciado sesión: inicia sesión en Ajustes \u{2192} Sincronización",
        "sync.notLoggedInShort" => "Sesión no iniciada",
        "sync.connectionError" => "Error de conexión: {0}",
        "sync.loginFailed" => "Error al iniciar sesión ({0}): {1}",
        "sync.invalidServerResponse" => "Respuesta no válida del servidor: {0}",
        "sync.sessionExpired" => "La sesión ha caducado: inicia sesión de nuevo",
        "sync.pushError" => "Error al enviar la sincronización: {0}",
        "sync.pushFailed" => "Error al enviar ({0}): {1}",
        "sync.pushRejectedOne" => "No se pudo enviar 1 cambio: {1}. Está en la cola y se volverá a intentar.",
        "sync.pushRejectedMany" => "No se pudieron enviar {0} cambios: {1}. Están en la cola y se volverá a intentar.",
        "sync.invalidPushResponse" => "Respuesta de envío no válida: {0}",
        "sync.pullError" => "Error al recibir la sincronización: {0}",
        "sync.pullFailed" => "Error al recibir ({0}): {1}",
        "sync.invalidPullResponse" => "Respuesta de recepción no válida: {0}",
        "sync.fullSyncError" => "Error en la sincronización completa: {0}",
        "sync.fullSyncFailed" => "La sincronización completa ha fallado ({0}): {1}",
        "sync.clientTooOld" => "Tu app de TimeTrack es demasiado antigua: actualízala para continuar. Tus cambios están a salvo en local.",
        "sync.invalidSyncResponse" => "Respuesta de sincronización no válida: {0}",
        "sync.couldNotOpenBrowser" => "No se pudo abrir el navegador: {0}",
        "sync.settingsFetchError" => "Error al obtener los ajustes: {0}",
        "sync.settingsFetchFailed" => "No se pudieron obtener los ajustes ({0}): {1}",
        "sync.invalidSettingsResponse" => "Respuesta de ajustes no válida: {0}",
        "sync.settingsPushError" => "Error al escribir los ajustes: {0}",
        "sync.settingsPushFailed" => "No se pudieron guardar los ajustes ({0}): {1}",

        // Auto-invoice
        "autoInvoice.klippekortNotFound" => "No se ha encontrado el bono de horas: {0}",
        "autoInvoice.clientNotFound" => "No se ha encontrado el cliente: {0}",
        "autoInvoice.noEntries" => "No se han encontrado registros de tiempo en el periodo elegido",
        "autoInvoice.defaultLineLabel" => "Trabajo de consultoría",

        // Browser extension
        "browser.couldNotFindExe" => "No se pudo encontrar la ruta del programa: {0}",
        "browser.invalidExePath" => "Ruta del programa no válida",
        "browser.couldNotFindAppData" => "No se pudo encontrar la carpeta de datos de la app: {0}",
        "browser.couldNotCreateManifestDir" => "No se pudo crear la carpeta del manifiesto: {0}",
        "browser.couldNotRegister" => "No se pudo registrar el native messaging en ningún navegador",
        "browser.registeredFor" => "Registrado para: {0}",
        "browser.couldNotFindHome" => "No se puede encontrar la carpeta personal",
        "browser.couldNotRunReg" => "No se pudo ejecutar reg.exe: {0}",
        "browser.registryError" => "Error del registro: {0}",

        // License
        "license.couldNotConnectServer" => "No se pudo conectar con el servidor de licencias. Comprueba tu conexión a internet. ({0})",
        "license.activationFailed" => "Error al activar ({0}): {1}",
        "license.invalidResponse" => "Respuesta no válida del servidor: {0}",
        "license.unknownError" => "Error desconocido",
        "license.couldNotCreateDataDir" => "No se pudo crear la carpeta de datos: {0}",
        "license.serializationError" => "Error de serialización: {0}",
        "license.couldNotSave" => "No se pudo guardar la licencia: {0}",
        "license.couldNotRemove" => "No se pudo quitar el archivo de licencia: {0}",
        "license.invalidVerifiedAt" => "verified_at no válido: {0}",
        "license.couldNotFindTrialPath" => "No se pudo encontrar la ruta de los datos de prueba",
        "license.couldNotSaveTrial" => "No se pudieron guardar los datos de prueba: {0}",
        "license.registryWriteError" => "Error al escribir en el registro: {0}",
        "license.invalidTrialFormat" => "Formato de trial_started_at no válido: {0}",

        // Health
        "health.dbCorrupt" => "La base de datos parece estar dañada: {0}",
        "health.couldNotRead" => "No se pudo leer de la base de datos: {0}",

        // Notification
        "notification.reviewTitle" => "Es hora de la revisión diaria",
        "notification.reviewBody" => "Hoy tienes {0} actividades sin confirmar. Haz clic para revisarlas.",

        // Update
        "update.checkFailed" => "Error al buscar actualizaciones: {0}",
        "update.installFailed" => "Error al instalar la actualización: {0}",
        "update.noUpdate" => "No hay ninguna actualización disponible",

        // Pomodoro
        "pomodoro.invalidMinutes" => "Número de minutos no válido: {0}",

        // Fallback
        _ => return key.to_string(),
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    #[test]
    fn default_language_is_danish() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("");
        assert_eq!(get_language(), "da");
        set_language("da");
    }

    #[test]
    fn set_and_get_language() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("en");
        assert_eq!(get_language(), "en");
        set_language("da");
    }

    #[test]
    fn danish_tray_translations() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("da");
        assert_eq!(t("tray.startTimer"), "Start timer");
        assert_eq!(t("tray.quit"), "Afslut");
        assert_eq!(t("tray.settings"), "Indstillinger");
    }

    #[test]
    fn english_tray_translations() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("en");
        assert_eq!(t("tray.startTimer"), "Start timer");
        assert_eq!(t("tray.quit"), "Quit");
        assert_eq!(t("tray.settings"), "Settings");
        set_language("da");
    }

    #[test]
    fn unknown_key_returns_key() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("da");
        assert_eq!(t("nonexistent.key"), "nonexistent.key");
    }

    #[test]
    fn t_fmt_replaces_args() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("da");
        let result = t_fmt("error.apiError", &["OpenAI", "401", "Unauthorized"]);
        assert_eq!(result, "OpenAI API fejl (401): Unauthorized");
    }

    /// Læser armene direkte ud af denne fils kilde.
    ///
    /// En `match` kan ikke spørges om sin egen nøglemængde, så porten læser
    /// kilden i stedet. Den ser derfor **alle** sprog, også dem der endnu kun
    /// findes i tabellen, og den kan ikke gå grøn fordi den kun kalder den
    /// funktion den gerne vil finde.
    fn arms_i_kilde(lang: &str) -> Vec<(String, String)> {
        let kilde = include_str!("i18n.rs");
        let start = kilde
            .find(&format!("fn t_{lang}(key: &str)"))
            .unwrap_or_else(|| panic!("fn t_{lang} findes ikke i kilden"));
        let slut = ["\nfn ", "\n#[", "\nmod "]
            .iter()
            .filter_map(|m| kilde[start..].find(m).map(|i| start + i))
            .min()
            .unwrap_or(kilde.len());
        let arms = &kilde[start..slut];
        let mut fundet = Vec::new();
        for linje in arms.lines() {
            let t = linje.trim();
            let Some(ydre) = t.strip_prefix('"') else {
                continue;
            };
            let Some((noegel, rest)) = ydre.split_once("\" => \"") else {
                continue;
            };
            if !noegel.contains('.') {
                continue;
            }
            fundet.push((noegel.to_string(), rest.trim_end_matches([',', '"']).to_string()));
        }
        fundet
    }

    fn placeholders(tekst: &str) -> Vec<char> {
        let mut fundet = Vec::new();
        let mut rest = tekst;
        while let Some(i) = rest.find('{') {
            // `\u{00e5}` er en unicode-escape, ikke en placeholder — ellers
            // læses hex-tallet som et `{0}`.
            let escape = rest[..i].ends_with("\\u");
            rest = &rest[i + 1..];
            if escape {
                if let Some(slut) = rest.find('}') {
                    rest = &rest[slut + 1..];
                }
                continue;
            }
            if let Some(c) = rest.chars().next().filter(|c| c.is_ascii_digit()) {
                fundet.push(c);
            }
        }
        fundet.sort_unstable();
        fundet
    }

    /// De fem tabeller skal have præcis samme nøgler — og samme placeholders.
    ///
    /// Uden denne port faldt sv, nb og de stille tilbage på dansk for 120 af
    /// 179 nøgler, altså to tredjedele af alle backend-fejl. En ny nøgle i
    /// `t_da` uden de tre modparters rækker er præcis det samme hul igen.
    #[test]
    fn noegle_paritet_mellem_de_seks_sprog() {
        use std::collections::{HashMap, HashSet};

        let da = arms_i_kilde("da");
        assert!(da.len() > 150, "t_da læses ikke — scanneren er nede: {}", da.len());
        let dansk: HashMap<&str, &str> =
            da.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let dansk_noegler: HashSet<&str> = dansk.keys().copied().collect();

        for lang in ["en", "sv", "nb", "de", "es"] {
            let tabellen = arms_i_kilde(lang);
            let nøgler: HashSet<&str> = tabellen.iter().map(|(k, _)| k.as_str()).collect();
            assert_eq!(
                nøgler.len(),
                tabellen.len(),
                "t_{lang} har en nøgle to gange"
            );

            let mut mangler: Vec<&str> = dansk_noegler.difference(&nøgler).copied().collect();
            mangler.sort_unstable();
            assert!(
                mangler.is_empty(),
                "t_{lang} mangler {} nøgler fra t_da: {mangler:?}",
                mangler.len()
            );

            let mut ekstra: Vec<&str> = nøgler.difference(&dansk_noegler).copied().collect();
            ekstra.sort_unstable();
            assert!(
                ekstra.is_empty(),
                "t_{lang} har nøgler t_da ikke kender: {ekstra:?}"
            );

            for (nøgle, værdi) in &tabellen {
                assert!(
                    !værdi.trim().is_empty(),
                    "t_{lang} har en tom værdi for {nøgle}"
                );
                assert_eq!(
                    placeholders(værdi),
                    placeholders(dansk[nøgle.as_str()]),
                    "t_{lang} har andre placeholders end t_da for {nøgle}"
                );
            }
        }
    }

    /// Svensk, norsk og tysk læser deres eget sprog i de fejl, der før
    /// faldt tilbage på dansk — altså ikke brugerens dansk.
    #[test]
    fn sv_nb_de_faller_ikke_tilbage_paa_dansk() {
        let _lock = TEST_MUTEX.lock().unwrap();
        // Fejl der ikke kan være ens på tværs af sprog, så et dansk
        // svar springer ud. `export.client` dømmer desuden ordet: appens egne
        // locale-filer siger "kund" på begge sprog (65 hhv. 15 forekomster,
        // nul for "klient"), så "Klient" var en dansk lækage.
        let nøgler = [
            "backup.fileNotFound",
            "sync.notLoggedInShort",
            "license.unknownError",
            "update.noUpdate",
            "error.unknownAiProvider",
            "export.client",
            "autoInvoice.clientNotFound",
        ];
        for lang in ["sv", "nb", "de", "es"] {
            set_language(lang);
            for nøgle in nøgler {
                let svar = t(nøgle);
                assert_ne!(
                    svar,
                    t_da(nøgle),
                    "{lang} læser dansk for {nøgle}: {svar}"
                );
            }
        }
        set_language("sv");
        assert_eq!(t("export.client"), "Kund");
        set_language("nb");
        assert_eq!(t("export.client"), "Kund");
        set_language("da");
    }

    #[test]
    fn csv_headers_translate() {
        let _lock = TEST_MUTEX.lock().unwrap();
        set_language("en");
        assert_eq!(t("export.date"), "Date");
        assert_eq!(t("export.hours"), "Hours");
        set_language("de");
        assert_eq!(t("export.date"), "Datum");
        assert_eq!(t("export.hours"), "Stunden");
        set_language("da");
    }
}

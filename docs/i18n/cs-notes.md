# Oversættelsesnoter: cs

Maskinelt udkast fra Claude (6/11-2026), ikke læst af en indfødt. Katalog: `src/i18n/messages/cs/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/cs/` (564), Chrome: `_locales/cs/` (5).

## Valg

- Tiltale: tykání ("tvůj", imperativ 2. person ental) i produkt-UI og mails til brugeren. Kundevendte tekster (`pdf.*`, `emailsBilling.*`, `portal.*`, kundemails) bruger vykání ("Vaše", "Vám") eller upersonlig form.
- **Klippekort = "balíček hodin"**.
- Faste termer: evidence času, záznam času, výkaz hodin, faktura, dobropis, hodinová sazba, vytížení, kniha jízd, zaměstnanec, uzávěrka období, klientský portál, stopky, předplatné, paušál (retainer), DPH.
- Plural: `one`, `few`, `many`, `other` i alle plural-blokke. `many` er i tjekkisk kun brøker.
- Procent skrives med mellemrum ("10 %"). Intervaller er skrevet "od … do …" eller "… až …".
- Kønsform: tykání-tekster bruger flere steder maskulinum ("jsi přihlášen", "sis vytvořil") eller "(a)" ("Zapomněl(a) jsi", "přihlášen(a)", "schválil(a)"). Omskrivning til neutrale former er ikke gennemført overalt.

## Usikre termer

- Lane (kanban): "sloupec". Seats: "místa". Pool (feriepulje): "druh"/"fond". Impersonation: "impersonace".
- Logbook: `logbook.title` og `shell.routes.logbook` er "Kniha příchodů" (fremmøde), ikke "kniha jízd", fordi kilden dér handler om ind- og udstempling. Tjek mod produktet.
- Clip: "krok" (afrundingstrin). Hole: "dírka". Founder: "Zakladatel". Plannavnet "Team" er hist og her "Tým".
- Hvor kilden ikke har plural, står "d."/"týd."/"min" eller tallet efter kolon ("Dní v řadě: {count}") for at undgå forkert kasus. `sharedFormat.timeHour` ("1 hodina"/"{h} hodin") er ukorrekt for 2-4.
- Datoformater i fejltekster er oversat ("RRRR-MM-DD"); ret hvis koden forventer den tekniske form.
- `emailsAuth.orgInvite.role.*` står i 7. kasus og `body` kan stå uharmonisk ved sammensætning i koden; tjek i en rigtig mail.
- `vacation.optionMonth` ("1. {name}") antager månedsnavn i genitiv; `previewRange` antager tal.
- `tasks.deleteLane.*`: `<b>` er flyttet omkring plural-blokken.
- Lovtekster (L68) er uofficielle oversættelser ("Neoficiální překlad").

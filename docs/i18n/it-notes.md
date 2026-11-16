# Italiano (it): note di traduzione

- Fonte: `en` (con `da` come controllo). Nomi di prodotto e marchio (`TimeWren`, `{brand}`, Billy, Dinero, e-conomic, Stripe) invariati.
- Tiltale: "tu" nell'interfaccia e nelle email all'utente; "Lei" (o forma impersonale) nei testi destinati ai clienti del freelance (`pdf`, `emailsBilling`, `portal`).
- Klippekort: **pacchetto ore** (ore prepagate). Saldo = "saldo", overrun = "sforamento".
- Termini fissi: registrazione ore, foglio ore, tariffa oraria, arrotondamento, fatturabile / non fatturabile, tasso di utilizzo, registro chilometrico, nota di credito, modello.
- Plurale: `one` + `many` + `other` (`many` uguale a `other`).
- Concetti giuridici danesi (CVR, SKAT, moms, Danløn, SD Løn, ferieloven) invariati, con breve spiegazione dove serve.
- Gli intervalli di date seguono `en` (trattino en).

## Termini incerti

- `logbook.title`: "Registro presenze" (è un riepilogo ingressi/uscite, non chilometri).
- "norma" / "periodo di norma" (flex norm danese): nessun equivalente diretto.
- "Responsabile" per manager; "chiusura aziendale" per fixed holiday; "ferie concomitanti" per concurrent holiday.
- `scheduledRates.dateFormat` e `ext.datesFormat`: "AAAA-MM-GG" è localizzato nel testo; il formato reale resta ISO.
- `sharedExport.headers.*` tradotte; se devono essere leggibili da macchina, riportarle all'originale.
- Controllo argomenti: due chiavi segnalate (`notifications.ev.closingReady.body`, `time.page.bulkMoved`), falso positivo (ramo `many` ripete le variabili).

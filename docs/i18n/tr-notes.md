# Tyrkisk (tr): valg og usikre termer

Status 6/11-2026. Maskinel oversættelse fra en (da som kontrol) af Claude, ikke læst af en indfødt. Kataloger: `src/i18n/messages/tr/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/tr/` (564 nøgler) og `browser-extension/_locales/tr/messages.json` (5 nøgler). Termerne følger `docs/i18n/glossary.md`; produktnavnet og `{brand}` er uoversat.

## Tiltale og register

"sen" i produkt-UI; "siz" i tekster til freelancerens kunder (pdf, emailsBilling, portal, kundemails, cookiebanner). Efter tal står substantivet i ental, så plural `one` og `other` er ens.

## Klippekort (prepaid package)

Valgt: **ön ödemeli paket**. Bogstaveligt "forudbetalt pakke"; ingen etableret tyrkisk term findes. Bruges 147 gange.

## Plural

`one` og `other`.

## Usikre termer og valg

- logbook-titel Çalışma günlüğü (ankomst/afgang), ikke sürüş günlüğü; waste = boşa giden süre
- lane = sütun / şerit (to filer): bør harmoniseres; manager = müdür / yönetici; Enterprise = Kurumsal
- holiday = yıllık izin / izin günü; absence = devamsızlık; clip size = dilim / klip; hole = delik; seat = koltuk
- VAT = KDV på dashboardet; passkey = geçiş anahtarı; push = anlık bildirim; DPA = veri işleme sözleşmesi
- Bekræftelsesordet for massesletning er SİL (tyrkisk i/İ): hvis koden sammenligner uden locale, kan det fejle; bør kontrolleres
- Apostrof før `{` undgås, fordi ICU læser den som citering ("{brand} uygulamasına" uden apostrof)

## Kendte emner til korrektur

- Danske lovbegreber og kolonnenavne i importfiler står uændret (koden matcher på dem).
- Quick-add-eksempler (opgaveparser) er bevidst på dansk, fordi parseren forstår dansk.
- Kataloget er ikke set i en browser; kun nøgler, pladsholdere, tags og plural-kategorier er kontrolleret maskinelt.

# Japansk (ja): valg og usikre termer

Status 6/11-2026. Maskinel oversættelse fra en (da som kontrol) af Claude, ikke læst af en indfødt. Kataloger: `src/i18n/messages/ja/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/ja/` (564 nøgler) og `browser-extension/_locales/ja/messages.json` (5 nøgler). Termerne følger `docs/i18n/glossary.md`; produktnavnet og `{brand}` er uoversat.

## Tiltale og register

です・ます-form, neutral tiltale uden 「あなた」. Kundevendte tekster (pdf, emailsBilling, portal) er høflige med 「様」; drip-mails fra grundlæggeren bruger 「さん」.

## Klippekort (prepaid package)

Valgt: **前払いパッケージ**. Direkte og forståeligt; "プリペイド" er mere teknisk. Bruges 344 gange.

## Plural

Kun `other` (sproget har ingen flertalsformer).

## Usikre termer og valg

- logbook-siden hedder 出退勤ログ (ankomst/afgang), ikke 走行記録 (kørsel), fordi siden ikke handler om kørsel; waste = ムダ時間
- VAT står som VAT (moms) med forklaring; Skattestyrelsen, Erhvervsstyrelsen, A-skat, B-skat, AM-bidrag står uændret med kort forklaring
- coverage = カバー率 (adskilt fra 稼働率); lane = レーン; seat = 席; clip size = 最小単位; hole (klippekort) = マス
- Kristne helligdage (Maundy Thursday osv.) er translittereret med gængse kristne betegnelser, ikke japanske helligdage
- Plannavne står i 「」; intervaller skrives med 〜; en-streger i `{from}–{to}` kan stå i et par formatstrenge

## Kendte emner til korrektur

- Danske lovbegreber og kolonnenavne i importfiler står uændret (koden matcher på dem).
- Quick-add-eksempler (opgaveparser) er bevidst på dansk, fordi parseren forstår dansk.
- Kataloget er ikke set i en browser; kun nøgler, pladsholdere, tags og plural-kategorier er kontrolleret maskinelt.

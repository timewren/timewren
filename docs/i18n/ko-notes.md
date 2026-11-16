# Koreansk (ko): valg og usikre termer

Status 6/11-2026. Maskinel oversættelse fra en (da som kontrol) af Claude, ikke læst af en indfødt. Kataloger: `src/i18n/messages/ko/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/ko/` (564 nøgler) og `browser-extension/_locales/ko/messages.json` (5 nøgler). Termerne følger `docs/i18n/glossary.md`; produktnavnet og `{brand}` er uoversat.

## Tiltale og register

해요체 i produkt-UI; 합니다체 i tekster til freelancerens kunder (pdf, emailsBilling, portal, kundemails). Grundlæggerens personlige mails er 해요체.

## Klippekort (prepaid package)

Valgt: **선불 패키지 (kort form 패키지 på trange flader)**. Naturligt ord; "클립"/"쿠폰" ville være misvisende. Bruges 344 gange.

## Plural

Kun `other` (sproget har ingen flertalsformer).

## Usikre termer og valg

- logbook-titel 출퇴근 일지 (ikke 운행 일지), waste = 낭비된 시간
- coverage = 커버리지 / 기록 비율 (adskilt fra 가동률); lane = 레인 (to filer) / 열 (én fil): bør harmoniseres ved korrektur
- clip size = 클립 단위 / 단위; hole = 칸; seat = 좌석; founding member = 파운딩
- manager = 관리자 i nogle filer og 매니저 i andre: kan forveksles med Admin-rollen
- Plannavne står i 「」 eller "" afhængigt af filen; bør ensrettes (ko bruger normalt "")
- moms = 부가세(moms); intervaller bruger ~ eller – (en-streg i et par formatstrenge)

## Kendte emner til korrektur

- Danske lovbegreber og kolonnenavne i importfiler står uændret (koden matcher på dem).
- Quick-add-eksempler (opgaveparser) er bevidst på dansk, fordi parseren forstår dansk.
- Kataloget er ikke set i en browser; kun nøgler, pladsholdere, tags og plural-kategorier er kontrolleret maskinelt.

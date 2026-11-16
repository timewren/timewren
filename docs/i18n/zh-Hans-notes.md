# Forenklet kinesisk (zh-Hans (Chrome: zh_CN)): valg og usikre termer

Status 6/11-2026. Maskinel oversættelse fra en (da som kontrol) af Claude, ikke læst af en indfødt. Kataloger: `src/i18n/messages/zh-Hans/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/zh-Hans/` (564 nøgler) og `browser-extension/_locales/zh_CN/messages.json` (5 nøgler). Termerne følger `docs/i18n/glossary.md`; produktnavnet og `{brand}` er uoversat.

## Tiltale og register

Uformelt 你 i produkt-UI; 您 i tekster til freelancerens kunder (emailsBilling, portal, portalInvite, kundeskabeloner). Fuldbredde tegnsætning. Intervaller skrives med 至.

## Klippekort (prepaid package)

Valgt: **预付时长包 (kort form 时长包)**. "套餐" ville blive forvekslet med abonnementsplaner. Bruges 344 gange.

## Plural

Kun `other` (sproget har ingen flertalsformer).

## Usikre termer og valg

- credit note = 贷项通知单 (juridisk korrekt; 红字发票 er et kinesisk skattebegreb og ville være misvisende)
- logbook-titel 日志 (ankomst/afgang), ikke 行车日志; waste = 空档时间
- lane = 泳道 / 列 (to filer): bør harmoniseres; seat = 席位; hole = 格 / 孔; clip size = 计费单位 / 扣减单位
- holiday-konti 年假, helligdage 公共假日; occupancy = 占用率, coverage = 覆盖率; passkey = 通行密钥
- Browserudvidelsens extName er "TimeTrack - 工时追踪"; søgeordslisten `settings.keywords` indeholder kun kinesiske ord (engelsk søgning matcher ikke)

## Kendte emner til korrektur

- Danske lovbegreber og kolonnenavne i importfiler står uændret (koden matcher på dem).
- Quick-add-eksempler (opgaveparser) er bevidst på dansk, fordi parseren forstår dansk.
- Kataloget er ikke set i en browser; kun nøgler, pladsholdere, tags og plural-kategorier er kontrolleret maskinelt.

# Oversættelsesnoter: pt-BR

Maskinelt udkast fra Claude (5-6/11-2026), ikke læst af en indfødt. Katalog: `src/i18n/messages/pt-BR/` (97 navneområder, 13.032 nøgler), `browser-extension/src/i18n/messages/pt-BR/` (564), Chrome: `_locales/pt_BR/` (5).

## Valg

- Brasiliansk portugisisk (registro, tela, arquivo, usuário, equipe, configurações, senha, entrar/sair, celular).
- Tiltale: "você" med neutral imperativ ("seu"). Kundevendte tekster bruger "você" eller upersonlig form.
- **Klippekort = "pacote de horas"**. "Banco de horas" bruges i Brasilien om arbejdstagerens timesaldo, så den undgås.
- Faste termer: registro de horas, fatura, nota de crédito, valor por hora, saldo, colaborador, fechamento de período, excluir, assinatura (subscription), "link mágico". Flex er "horário flexível" (på pt-BR `enterpriseSettings` dog "banco flexível").
- GDPR er "LGPD" hvor det handler om brugerens egen databeskyttelse, og "GDPR" hvor kilden henviser til EU-forordningen (`settingsDpa`). Det er ikke gennemført helt ensartet (se usikre punkter).
- Google-produkter bruger de brasilianske navne (Google Agenda, Google Planilhas).
- Plural: `one` og `other`.

## Usikre termer

- Seats: "licenças". Rolle: "papel". Membership: "vínculo". Manager: "gestor". Payroll wage code: "rubrica". Employee number: "matrícula".
- Tags: "Tags" (pt-PT bruger "etiquetas"). Passkey: "passkey".
- "LGPD/GDPR" står i flere sidefødder og FAQ-spørgsmål, mens svaret kun siger "GDPR". Samles senere.
- "1 hole" på klippekortet: "1 furo". "Clip size": "tamanho do bloco".
- Plannavne (Free, Team osv.) er ikke oversat.
- `dailyHours.day`: tre bogstaver (Dom, Seg ...) kan være for bredt til diagrammet.
- Danske lovtekster er uofficielle oversættelser. Ekstra `one`-grene er tilføjet, hvor kilden kun havde `=0`/`other`.

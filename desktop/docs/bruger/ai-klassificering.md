# AI-klassificering

## Hvad er AI-klassificering?

AI-klassificering hjælper dig med at kategorisere dine automatisk registrerede aktiviteter. I stedet for manuelt at gennemgå hver aktivitet og tildele den et projekt, kan AI'en foreslå hvilken aktivitet der hører til hvilket projekt.

## Vælg en provider

Gå til **Indstillinger → AI** og vælg en af de understøttede providers:

| Provider | Fordele | Kræver internet |
|----------|---------|-----------------|
| **OpenAI** (GPT-4o) | Høj kvalitet, hurtig | Ja |
| **Claude** (Anthropic) | God til dansk tekst | Ja |
| **Google Gemini** | Gratis tier tilgængelig | Ja |
| **OpenRouter** | Adgang til mange modeller | Ja |
| **Ordbogen.ai** | Dansk provider | Ja |
| **Ollama** | Lokal LLM, helt privat | Nej |

## BYOK -- Bring Your Own Key

TimeTrack Desktop bruger **din egen API-nøgle** til AI-kald. Det betyder:

- Du betaler direkte til din valgte provider (typisk få øre per klassificering)
- TimeTrack har aldrig adgang til din nøgle -- den gemmes kun lokalt
- Du kan skifte provider eller nøgle når som helst

### Indtast API-nøgle

1. Opret en konto hos din valgte provider
2. Generér en API-nøgle i providerens dashboard
3. Gå til **Indstillinger → AI** i TimeTrack Desktop
4. Vælg provider og indsæt din API-nøgle
5. Klik **Gem**

## Lokal LLM via Ollama

Hvis du vil køre AI-klassificering helt lokalt uden internet:

1. Installér [Ollama](https://ollama.com/) på din computer
2. Download en model: `ollama pull llama3.2` (eller en anden model)
3. Start Ollama (den kører som en lokal server)
4. Vælg **Ollama** som provider i TimeTrack Desktop
5. Angiv modelnavn (fx `llama3.2`) -- ingen API-nøgle nødvendig

**Fordele ved lokal LLM:**
- Dine data forlader aldrig din computer
- Ingen løbende omkostninger
- Virker uden internet

**Ulemper:**
- Kræver en computer med tilstrækkelig RAM (8 GB+ anbefales)
- Kvaliteten kan variere afhængigt af modellen
- Langsommere end cloud-baserede providers

## Hvordan klassificering virker

Klassificeringen kører i tre trin:

### 1. Brugerregler (højeste prioritet)

Hvis du har oprettet egne regler under **Indstillinger → AI → Regler**, tjekkes de først. Eksempel:

- "Hvis vinduestitel **indeholder** 'timetrack' → Projekt: TimeTrack Desktop"
- "Hvis program **er lig med** 'Figma' → Projekt: Design"

### 2. Historiske mønstre

Appen husker dine tidligere bekræftelser. Hvis du ofte bekræfter Chrome-vinduer med "Jira" i titlen som "Projektledelse", vil den foreslå det samme næste gang.

### 3. AI-klassificering

Hvis hverken regler eller historik matcher, sendes aktiviteten til din valgte AI-provider. AI'en modtager:
- Dine projekter og klienter
- Aktivitetens programnavn og vinduestitel
- Dine eksisterende regler (som kontekst)

AI'en returnerer et projekt-forslag og en kategori (fx "Udvikling", "Møde", "Kommunikation").

## Opret klassificeringsregler

1. Gå til **Indstillinger → AI**
2. Klik **Ny regel**
3. Vælg felt (vinduestitel eller programnavn)
4. Vælg operator (indeholder, er lig med, starter med, regex)
5. Angiv mønster (fx "Slack")
6. Vælg projekt og kategori
7. Klik **Gem**

Regler evalueres i prioriteret rækkefølge -- den første der matcher, vinder.

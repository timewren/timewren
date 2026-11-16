# Cloud sync

## Hvad synkroniseres?

Når du forbinder TimeTrack Desktop med TimeTrack Cloud, synkroniseres følgende data:

| Synkroniseres | Synkroniseres IKKE |
|---------------|--------------------|
| Klienter | Aktiviteter (auto-tracking data) |
| Projekter | Klassificeringsregler |
| Tidsregistreringer | AI-indstillinger og API-nøgler |
| Klippekort | App-indstillinger |

**Vigtigt**: Dine aktivitetsdata (hvilke apps og vinduer du bruger) synkroniseres aldrig til skyen. Det er en bevidst privacy-beslutning.

## Forbind til TimeTrack Cloud

1. Gå til **Indstillinger → Sync**
2. Klik **Log ind**
3. Din browser åbner TimeTrack login-siden
4. Log ind med din TimeTrack-konto
5. Du sendes automatisk tilbage til desktop-appen

Login bruger en sikker deep link (`timetrack://auth/callback`) -- du behøver ikke kopiere nøgler manuelt.

## Organisations-valg

Hvis din TimeTrack-konto tilhører flere organisationer, vælger du hvilken du vil synkronisere med:

1. Efter login vises en liste over dine organisationer
2. Vælg den organisation du vil synkronisere med
3. Klik **Forbind**

Du kan skifte organisation senere under Indstillinger → Sync.

## Automatisk sync

Når du er forbundet, synkroniserer appen automatisk:

- **Ved opstart**: Henter nye data fra skyen
- **Ved ændringer**: Sender dine ændringer til skyen løbende
- **Periodisk**: Tjekker for opdateringer i baggrunden

Du kan også udløse sync manuelt ved at klikke på sync-ikonet i statusbaren.

## Offline-mode

TimeTrack Desktop virker fuldt ud uden internet:

- Alle data gemmes lokalt i SQLite
- Du kan oprette klienter, projekter, tidsregistreringer og klippekort offline
- Ændringer gemmes i en sync-kø
- Når internet er tilgængeligt igen, synkroniseres køen automatisk

### Konflikthåndtering

Hvis den samme registrering er ændret både lokalt og i skyen, vinder sky-versionen (server-wins). Det er sjældent et problem i praksis, da desktop-appen typisk er den eneste klient.

## Log ud

1. Gå til **Indstillinger → Sync**
2. Klik **Log ud**

Dine lokale data slettes ikke ved logud -- du mister bare synkroniseringen. Du kan logge ind igen senere.

## Kræver abonnement

Cloud sync kræver et aktivt TimeTrack-abonnement. Uden abonnement fungerer appen fuldt ud offline med alle lokale funktioner.

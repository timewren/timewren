# Français (fr): notes de traduction

- Source : `en` (`da` en contrôle). Noms de produit et de marque (`TimeWren`, `{brand}`, Billy, Dinero, e-conomic, Stripe) inchangés.
- Tiltale : « vous » partout (UI, e-mails à l'utilisateur et textes destinés aux clients du freelance).
- Klippekort : **forfait d'heures** (heures prépayées). Solde = « solde », dépassement = « dépassement ».
- Termes fixes : saisie de temps, feuille de temps, taux horaire, arrondi, facturable / non facturable, taux d'utilisation, carnet de déplacements, avoir, modèle.
- Pluriel : `one` + `many` + `other` (`many` identique à `other`). CLDR exige `many` en français (grands nombres, « 1 million de jours ») : ne pas supprimer cette branche, même si elle répète `other`.
- Apostrophe avant balise : jamais d’apostrophe droite juste avant `<tag>` (ICU lit `'<` comme un littéral cité et le lien disparaît) ; reformuler (« la <link>…</link> »).
- Le signe `§` est conservé dans les renvois juridiques, suivi d’une espace insécable.
- Typographie : espaces insécables avant `: ; ? !` et « % », guillemets « » avec espaces insécables.
- Notions légales danoises (CVR, SKAT, moms, Danløn, SD Løn, ferieloven) inchangées.
- Les séparateurs de plages de dates suivent `en` (tiret demi-cadratin).

## Termes incertains

- « forfait d'heures » ou « carte d'heures » : forfait retenu, plus courant dans les logiciels de facturation.
- « carnet de déplacements » pour logbook (kilométrage).
- « norme » (période de norme, enterprise flex) : pas d'équivalent français direct.
- La vérification de paramètres d'arguments signale deux clés (`notifications.ev.closingReady.body`, `time.page.bulkMoved`) : faux positif, la branche `many` répète les mêmes variables.

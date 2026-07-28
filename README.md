# RouteRijder — direct te publiceren

## Op GitHub Pages zetten

1. Pak de ZIP uit.
2. Maak op GitHub een nieuwe **public** repository, bijvoorbeeld `routerijder`.
3. Kies **uploading an existing file** en upload alle bestanden uit de uitgepakte map.
4. Klik onderaan op **Commit changes**.
5. Ga naar **Settings > Pages**.
6. Kies bij **Source**: `Deploy from a branch`.
7. Kies branch `main` en map `/ (root)` en klik **Save**.
8. Na enkele minuten staat de site op:
   `https://JOUW-GEBRUIKERSNAAM.github.io/routerijder/`

## Eerste gebruik

1. Maak een GraphHopper API-key aan via het GraphHopper-dashboard.
2. Open RouteRijder en klik op het tandwiel.
3. Plak de key en sla op.
4. Open de website op je telefoon via HTTPS.
5. Geef toestemming voor locatiegebruik.
6. Kies `Start GPS`, zoek een adres of laad een GPX-bestand.

## Wat werkt

- Live GPS en kaartrotatie op basis van rijrichting.
- Adres zoeken en routeberekening via GraphHopper.
- GPX-import.
- Detectie wanneer je circa 60 meter van de route afwijkt.
- Berekening van tijdelijke routes naar meerdere punten verderop.
- Hervatten van de oorspronkelijke GPX-route zodra je opnieuw aansluit.
- Installeerbaar als PWA.

## Beperkingen van deze eerste versie

- De GraphHopper-key staat lokaal in de browser. Voor breed publiek gebruik moet deze achter een proxy.
- De oorspronkelijke GPX wordt nog niet vooraf gematcht op het wegennet.
- OpenStreetMap publieke tiles zijn bedoeld voor beperkt prototypegebruik.
- Achtergrond-GPS is in mobiele browsers niet volledig betrouwbaar.
- Test de toepassing niet actief tijdens het besturen; gebruik een telefoonhouder en stel routes vooraf in.

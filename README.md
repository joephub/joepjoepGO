# joepjoepGO v23

Deze versie bundelt verbeteringen aan de startflow en de bediening tijdens navigeren.

## Gewijzigd

- De app opent met een keuze tussen **Navigeer naar adres** en **Open een GPX**.
- De adresplanner en GPX-functies worden niet meer tegelijk getoond.
- Gewone voortgangsmeldingen worden niet meer als donker/blauw bericht over de kaart getoond. Alleen fouten verschijnen nog tijdelijk in beeld.
- Een actieve GPS-fix geeft geen permanente melding meer. Alleen wanneer GPS wordt gezocht, uitstaat of niet beschikbaar is, verschijnt bovenin een kleine waarschuwing.
- Bij de eerste druk op het rode kruis wordt navigatie gepauzeerd. Daarna verschijnen zowel een groene hervatknop als een rood kruis om de navigatie definitief te beëindigen.
- Definitief stoppen keert terug naar het route-overzicht; de berekende route blijft beschikbaar om opnieuw te starten.
- De tankstationknop toont tijdens het zoeken een draaiende indicator en kan niet meerdere keren tegelijk worden ingedrukt.
- Bij een normale adresroute wordt **Andere GPX** niet meer getoond. Die knop verschijnt alleen bij een geladen GPX.

## Publiceren op GitHub Pages

1. Pak de ZIP uit.
2. Upload alle bestanden naar de hoofdmap van de GitHub-repository en vervang de bestaande bestanden.
3. Commit de wijzigingen.
4. Open de site met `?v=23`, bijvoorbeeld `https://joephub.github.io/maps/?v=23`.
5. Controleer linksonder of **joepjoepGO v23** staat.

De service worker is tijdens de ontwikkelfase bewust uitgeschakeld om oude versies uit de browsercache te voorkomen.

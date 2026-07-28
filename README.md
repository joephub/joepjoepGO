# joepjoepGO v24

Deze versie verbetert de mobiele liggende navigatie en de visuele waarschuwing voor afslagen.

## Gewijzigd

- Het informatiepaneel in mobiele liggende stand gebruikt de beschikbare hoogte beter.
- De volgende manoeuvre, afstand en resterende ritgegevens zijn in liggende stand duidelijk groter.
- De GraphHopper-codes voor **links/rechts aanhouden** (`-7` en `7`) worden nu als diagonale pijlen getoond in plaats van als rechtdoor.
- Normale bochten gebruiken duidelijkere pijlen: links/rechts horizontaal, licht afbuigen diagonaal en scherp afbuigen schuin omlaag.
- Wanneer een API-antwoord richtingtekst bevat maar een neutrale code teruggeeft, wordt de richting ook uit de tekst afgeleid.
- Binnen 500 meter van een echte manoeuvre knippert linksboven op de kaart een klein geel waarschuwingsteken.
- Het waarschuwingsteken verdwijnt bij pauzeren, stoppen, rechtdoor rijden of wanneer de manoeuvre verder dan 500 meter ligt.

## Publiceren op GitHub Pages

1. Pak de ZIP uit.
2. Upload alle bestanden naar de hoofdmap van de GitHub-repository en vervang de bestaande bestanden.
3. Commit de wijzigingen.
4. Open de site met `?v=24`, bijvoorbeeld `https://joephub.github.io/maps/?v=24`.
5. Controleer linksonder of **joepjoepGO v24** staat.

De service worker is tijdens de ontwikkelfase bewust uitgeschakeld om oude versies uit de browsercache te voorkomen.

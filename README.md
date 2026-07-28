# joepjoepGO v28

Statische GitHub Pages-versie van joepjoepGO met adresnavigatie, GPX-analyse, GPX-bewerking en motorvriendelijke GPX-navigatie.

## Nieuw in v28

### Twee manieren om een GPX te rijden

Na het kiezen van één of meerdere GPX-trajecten vraagt joepjoepGO hoe de route moet worden opgebouwd:

- **Hybride route**: wegdelen worden alleen als normale rijroute gebruikt wanneer de berekende lijn binnen de gekozen tolerantie van de oorspronkelijke GPX blijft. De standaard is 30 meter. Twijfelachtige en offroaddelen blijven exact de GPX volgen.
- **GPX exact volgen**: alle bestaande GPX-punten blijven onaangetast. Alleen gaten tussen losse bestanden, tracks of segmenten worden als nieuwe wegverbinding berekend.

De routevoorvertoning gebruikt verschillende kleuren:

- blauw: betrouwbaar aan een weg gekoppeld;
- oranje: exacte GPX/offroad;
- groen: nieuw berekend verbindingsstuk;
- rood: niet automatisch opgeloste verbinding;
- grijs gestippeld: oorspronkelijke GPX ter vergelijking.

Op exacte/offroaddelen probeert de app tijdens het rijden niet automatisch naar een gewone weg terug te routeren.

### Startpunt bewerken

In **Bewerk GPX** kan het huidige startpunt nu worden verwijderd. Het eerstvolgende overgebleven punt wordt dan automatisch het nieuwe startpunt.

Een ander routepunt kan ook worden geselecteerd en met **Maak startpunt** als begin worden ingesteld:

- bij een gesloten rondrit wordt de routevolgorde rondgedraaid;
- bij een open route vraagt de app toestemming om de punten vóór het nieuwe startpunt weg te laten;
- het eindpunt blijft beschermd, zodat minimaal een bruikbare route overblijft.

Start- en eindpunt hebben op de kaart een eigen kleur en kunnen net als andere punten worden versleept.

### Meerdere GPX-bestanden

Meerdere bestanden en geselecteerde analysetrajecten kunnen in één route worden verwerkt. Bestaande GPX-delen blijven in hun gekozen volgorde behouden; alleen een volgend deel wordt omgedraaid wanneer dat duidelijk beter op het vorige uiteinde aansluit.

## Publiceren

Upload alle bestanden uit deze map naar de root van de GitHub Pages-repository. Open de site daarna eenmalig met:

```text
?v=28
```

Controleer linksonder of **joepjoepGO v28** staat.

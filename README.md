# joepjoepGO v30

## Verbeterde hybride GPX-herkenning

De hybride analyse werkt nu met korte lokale vensters in plaats van eerst complete delen van circa 18 km goed of fout te verklaren. Daardoor kan een traject afwisselend bestaan uit:

- blauw: lokaal betrouwbaar aan een weg gekoppeld;
- oranje: exact GPX/offroad behouden;
- groen: berekende verbinding tussen losse GPX-trajecten;
- rood: verbinding die handmatig moet worden gecontroleerd.

Een enkel bospad of een afwijkend stuk maakt niet meer automatisch de rest van het traject oranje. De vergelijking is bovendien bestand tegen enkele GPS- en kaartuitschieters. Routeaanvragen worden begrensd en bij een GraphHopper-limiet stopt de verwerking met een duidelijke fout in plaats van alle resterende delen stilzwijgend oranje te maken.

Een corridor van 10 meter is zeer strikt. Voor opgenomen motorroutes is 30 meter meestal een betere keuze, omdat GPS-sporen en de wegmiddellijn enkele meters uit elkaar kunnen liggen.

## Publiceren

Upload alle bestanden naar de hoofdmap van de GitHub Pages-repository en open daarna:

```text
?v=30
```

Controleer linksonder of **joepjoepGO v30** staat.

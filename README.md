# joepjoepGO v29

## Belangrijkste correctie

De hybride GPX-verwerking gebruikt voortaan de gewone GraphHopper Routing API als corridorproef. Het Map Matching-onderdeel is niet in ieder GraphHopper-abonnement beschikbaar. Een fout of ontbrekend abonnement wordt daardoor niet meer ten onrechte uitgelegd als een offroaddeel.

Per GPX-deel berekent joepjoepGO een wegroute door enkele vormpunten. Daarna vergelijkt de app de volledige berekende lijn met de oorspronkelijke GPX:

- blijft de wegroute volledig binnen de gekozen tolerantie, dan wordt het deel blauw;
- wijkt de wegroute te veel af, dan onderzoekt de app kleinere delen afzonderlijk;
- alleen delen waarvoor geen betrouwbare wegroute binnen de corridor bestaat, blijven oranje;
- echte openingen tussen GPX-trajecten blijven groen of rood volgens de bestaande logica.

Hierdoor moeten gewone wegen zoals in het gemelde voorbeeld blauw worden, terwijl bewuste offroadstukken exact als oranje GPX behouden blijven.

## Publiceren

Upload alle bestanden naar de hoofdmap van de GitHub Pages-repository en open daarna:

```text
?v=29
```

Controleer linksonder of **joepjoepGO v29** staat.

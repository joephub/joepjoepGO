# joepjoepGO v27

Statische GitHub Pages-versie van joepjoepGO met adresnavigatie, GPX-analyse, GPX-bewerking en GPX-naar-rijroute.

## Nieuw in v27

### Meerdere GPX-bestanden en trajecten naar één route

- Selecteer meteen meerdere `.gpx`-bestanden in het bestandsvenster, of voeg later extra bestanden toe via **Voeg GPX toe**.
- Alle gevonden tracks, tracksegmenten en door de analyse herkende trajecten worden standaard geselecteerd.
- Via **Analyse** kun je één of meerdere trajecten aanvinken.
- **Maak 1 rijroute** verwerkt alle geselecteerde trajecten in één bewerking.
- De app bepaalt per volgend traject welke rijrichting het beste aansluit.
- Ieder traject wordt afzonderlijk op het wegennet gelegd.
- Lege stukken tussen trajecten worden als een normale route over het wegennet berekend.
- Wanneer de selectie verandert, wordt een eerder gemaakte route ongeldig verklaard en niet meer als actuele route getoond.

### GPX starten zonder losse GPS-foutmelding

- Op mobiel opent eerst een keuzescherm voor:
  - navigeren naar het officiële startpunt;
  - aansluiten op de dichtstbijzijnde plek van de GPX-route.
- De GPS-locatie wordt automatisch opgehaald.
- Tijdens het wachten staat de voortgang in datzelfde keuzescherm.
- Bij een GPS-probleem verschijnt daar een duidelijke fout met **Opnieuw proberen**, in plaats van een losse rode melding over de kaart.
- Na het kiezen van een instapmethode worden dubbele tikken tijdelijk geblokkeerd.

### GPX bewerken

- **Bewerk GPX** is zichtbaar zodra een GPX is geladen.
- Bij één traject opent de editor direct.
- Bij meerdere nog niet samengevoegde trajecten opent de analyse om een traject te kiezen.
- Nadat meerdere trajecten tot één rijroute zijn samengevoegd, kan de volledige samengestelde route worden bewerkt.
- Punten kunnen worden geselecteerd, versleept, toegevoegd, in volgorde verplaatst of gezamenlijk verwijderd.


### Vaste schermoriëntatie tijdens het rijden

- De mobiele app start altijd in de normale staande stand.
- Beweging of schuin hangen van de telefoon verandert de app-indeling niet meer.
- De rotatieknop verschijnt alleen tijdens navigatie of simulatie.
- Iedere druk draait de app 90 graden verder: staand, liggend, ondersteboven en de andere liggende stand.
- Op desktop wordt de app nooit gedraaid.
- Wanneer de browser de Screen Orientation API niet toestaat, gebruikt de app dezelfde vier standen via een softwarematige rotatie.

## Publiceren

Upload alle bestanden uit deze map naar de root van de GitHub Pages-repository. Open de site daarna eenmalig met:

```text
?v=27
```

Controleer linksonder of **joepjoepGO v27** staat.

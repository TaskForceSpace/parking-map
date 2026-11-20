# Parking Map

Vue-3-Library für Parkflächen. `ParkingMapEditor` erfasst Parkflächen und Stellplätze direkt auf einer zoombaren Karte. `ParkingMap` zeigt einen SVG-Lageplan aus dem Standardslot an.

## Lokal testen

```sh
npm install
npm run dev
```

Vite gibt die URL der Testseite aus. Im Entwicklungsmodus lädt sie den öffentlichen Einstiegspunkt direkt aus dem Quellcode.

Lege die benötigten Ebenen an und wähle die zu bearbeitende Ebene oben aus. Straßenkarte ist die Standardansicht. Unter **Grundriss** arbeitest du auf einer grauen Fläche oder mit einem optionalen PNG-, JPEG- oder WebP-Bild. Der Editor passt es beim Upload in den aktuellen Kartenausschnitt ein. Für Außenflächen stehen außerdem Luftbild und Ortssuche zur Verfügung.

Wähle **Bereich markieren**, setze die Eckpunkte per Klick und klicke auf **Polygon abschließen**. Über **Parkfläche bearbeiten** verschiebst du das Polygon am mittleren Griff oder skalierst es über Länge und Tiefe. Stelle Breite und Tiefe der neuen Stellplätze ein und platziere sie per Klick auf freie Fläche. Ein Klick auf einen vorhandenen Stellplatz öffnet seinen Dialog an der Karte.

Mit dem Muster `BR-?` und der nächsten Nummer `50` entstehen die IDs `BR-50`, `BR-51` und so weiter. Mehrere Fragezeichen füllen mit führenden Nullen auf. Das Standardmuster `P???` startet mit `P001`. Bereits vergebene IDs werden übersprungen.

## Editor einbinden

**Magnetische Ausrichtung** ist standardmäßig aktiv. Beim Platzieren zeigt der Editor neben langen Kanten eine gestrichelte Vorschau. Beim Verschieben rastet der Stellplatz an der nächstgelegenen Kante eines Nachbarn ein. Die Karte zeigt die ausgerichtete Position bereits beim Ziehen.

```vue
<script setup>
import { ref } from 'vue';
import { ParkingMapEditor } from 'parking-map';
import 'parking-map/style.css';

const draft = ref(null);
</script>

<template>
  <ParkingMapEditor level="E0" @change="draft = $event" />
</template>
```

Zum Bearbeiten eines gespeicherten Plans übergib `initial-layout` beim Einhängen des Editors. Vorhandene Stellplatz-IDs werden im Entwurf beibehalten. Die Anwendung kann die Bearbeitung von Namen über `editable-spot-names` abschalten.

`change` liefert unter `levels` pro Ebene das Polygon, die Stellplätze und gegebenenfalls das Grundrissbild als Daten-URL mit Kartengrenzen. Innerhalb von `area` beschreiben `south`, `west`, `north` und `east` den Begrenzungsrahmen des Polygons. `corners` enthält die Eckpunkte. Auf oberster Ebene stehen weiterhin die Fläche der ersten Ebene und die gemeinsame Stellplatzliste mit `level` pro Stellplatz. Stellplatzwinkel werden im Uhrzeigersinn gegenüber der achsenparallelen Ausrichtung gemessen. Der Entwurf liegt im Arbeitsspeicher der Komponente. Die Testseite exportiert ihn als JSON.

Die Testseite verwendet OpenStreetMap, Esri World Imagery und Nominatim. Die Straßenkarte lässt sich über `tile-url`, `tile-attribution` und `tile-max-native-zoom` konfigurieren, das Luftbild über `imagery-url`, `imagery-attribution` und `imagery-max-native-zoom`. Der über `search-url` konfigurierbare Suchdienst muss die Nominatim-JSONv2-Schnittstelle anbieten.

## Paket und Testseite bauen

```sh
npm run build
npm run build:playground
npm run preview
```

Der Library-Build liegt in `dist/`. Die gebaute Testseite verwendet diesen Build und liegt in `playground/dist/`. `npm pack` erstellt ein installierbares Paket mit Vue als Peer Dependency.

## SVG-Lageplan anzeigen

Für gespeicherte Layouts exportiert das Paket auch `ParkingMapViewer`. Die Testseite öffnet ihn über **Kartenansicht öffnen** für den aktuellen Entwurf. Der Viewer benötigt keine API und zeichnet standardmäßig auf einer neutralen Fläche.

```vue
<ParkingMapViewer
  :layout="layout"
  :spot-states="{ 123: { label: 'BR-50', status: 'occupied' } }"
  :highlighted-spot-id="highlightedId"
  :focused-spot-id="focusedId"
  @spot-click="openSpot"
/>
```

Der Viewer erwartet `layout.levels` mit `level`, `area.corners` und `parking_spots` wie beim Editor. Gib pro Stellplatz vorzugsweise ein eindeutiges `id` an. Für lokale Entwürfe dient andernfalls `spot_name` als ID. Die Zustände `available`, `occupied` und `unavailable` kommen von der einbindenden Anwendung. Der Punkt neben dem Namen zeigt die Belegung. Über das optionale boolesche Feld `occupied` lässt sie sich unabhängig vom Verfügbarkeitsstatus angeben. `spot-click` und `spot-context` melden `{ id, level, originalEvent }` und unterstützen Maus- und Tastaturbedienung. `spot-hover` meldet `{ id, level }` oder beim Verlassen `null`. `level-change` meldet den Namen der neuen Ebene.

### SVG als Slot übergeben

```vue
<script setup>
import { ParkingMap } from 'parking-map';
</script>

<template>
  <ParkingMap label="Stellplatz A01" viewBox="0 0 100 100">
    <rect x="20" y="10" width="60" height="80" fill="#304558" />
  </ParkingMap>
</template>
```

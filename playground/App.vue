<script setup>
import { ref } from 'vue';
import { ParkingMapEditor, ParkingMapViewer } from 'parking-map';
import 'parking-map/style.css';

const draft = ref({ area: null, parking_spots: [], levels: [] });
const showPreview = ref(false);
const previewSpot = ref(null);

function downloadDraft() {
  const file = new Blob([JSON.stringify(draft.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'parkflaeche.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <main class="editor-page">
    <header class="editor-page__header">
      <h1>Parkflächen erfassen</h1>
      <p>Parkflächen pro Ebene markieren und Stellplätze per Klick setzen.</p>
    </header>
    <ParkingMapEditor v-show="!showPreview" @change="draft = $event" />
    <ParkingMapViewer
      v-if="showPreview"
      :layout="draft"
      :highlighted-spot-id="previewSpot"
      @spot-click="previewSpot = $event.id"
    />
    <footer class="editor-page__footer">
      <span>{{ draft.parking_spots.length }} {{ draft.parking_spots.length === 1 ? 'Stellplatz' : 'Stellplätze' }} gesamt</span>
      <button type="button" :disabled="!draft.levels.length" @click="downloadDraft">JSON herunterladen</button>
      <button type="button" :disabled="!draft.levels.length" @click="showPreview = !showPreview">
        {{ showPreview ? 'Zurück zum Editor' : 'Kartenansicht öffnen' }}
      </button>
    </footer>
  </main>
</template>

<style>
body {
  margin: 0;
  background: #f1f5f6;
  color: #172a35;
  font: 1rem system-ui, sans-serif;
}

.editor-page {
  box-sizing: border-box;
  max-width: 95rem;
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
}

.editor-page__header {
  margin-bottom: 1.15rem;
}

.editor-page__header h1 {
  margin: 0 0 0.35rem;
  font-size: clamp(1.5rem, 2.6vw, 2.3rem);
  letter-spacing: -0.035em;
}

.editor-page__header p {
  margin: 0;
  color: #536975;
}

.editor-page__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.85rem;
  color: #536975;
  font-size: 0.85rem;
}

.editor-page__footer button {
  padding: 0.55rem 0.8rem;
  border: 1px solid #0c6370;
  border-radius: 0.5rem;
  color: white;
  background: #0c6370;
  font: 600 0.85rem/1.25 system-ui, sans-serif;
}

.editor-page__footer button:enabled {
  cursor: pointer;
}

.editor-page__footer button:disabled {
  opacity: 0.5;
}
</style>

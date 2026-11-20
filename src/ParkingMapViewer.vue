<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { projectedUnitsPerMeter } from './mapScale.js';

const props = defineProps({
  layout: { type: Object, required: true },
  tileUrl: { type: String, default: '' },
  tileAttribution: { type: String, default: '' },
  tileMaxNativeZoom: { type: Number, default: 19 },
  spotStates: { type: Object, default: () => ({}) },
  highlightedSpotId: { type: [String, Number], default: null },
  focusedSpotId: { type: [String, Number], default: null },
});

const emit = defineEmits(['spot-click', 'spot-context', 'spot-hover', 'level-change']);
const element = ref(null);
const levelName = ref('');
const levels = computed(() => props.layout?.levels ?? []);
const activeLevel = computed(() => levels.value.find(level => level.level === levelName.value));
const failed = ref(false);
const paths = new Map();
let leaflet;
let map;
let shapes;
let background;
let observer;
let disposed = false;

onMounted(async () => {
  try {
    leaflet = (await import('leaflet')).default;
    if (disposed) return;
    map = leaflet.map(element.value, { maxZoom: 23, zoomSnap: 0.25 }).setView([0, 0], 2);
    shapes = leaflet.featureGroup().addTo(map);
    observer = new ResizeObserver(() => {
      if (!element.value?.clientWidth || !element.value.clientHeight) return;
      map.invalidateSize({ pan: false });
      if (needsFit) {
        fitLevel();
        focusSpot();
      }
    });
    observer.observe(element.value);
    syncLayout();
    if (props.tileUrl) {
      leaflet.tileLayer(props.tileUrl, {
        attribution: props.tileAttribution,
        maxNativeZoom: props.tileMaxNativeZoom,
        maxZoom: map.getMaxZoom(),
      }).addTo(map);
    }
  } catch {
    failed.value = true;
  }
});

onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  map?.remove();
});

const spotId = spot => spot.id ?? spot.spot_name;
const keyOf = id => String(id);
const coordinates = point => [Number(point.latitude), Number(point.longitude)];
let needsFit = false;

function syncLayout() {
  if (!map) return;
  const focus = props.focusedSpotId;
  const focusedLevel = focus == null ? undefined : levels.value.find(level =>
    level.parking_spots.some(spot => keyOf(spotId(spot)) === keyOf(focus)));
  levelName.value = focusedLevel?.level ?? activeLevel.value?.level ?? levels.value[0]?.level ?? '';
  drawLevel();
  if (focusedLevel) focusSpot();
}

function changeLevel(name) {
  levelName.value = name;
  drawLevel();
  emit('level-change', name);
}

function drawLevel() {
  shapes.clearLayers();
  paths.clear();
  background?.remove();
  background = undefined;
  const level = activeLevel.value;
  if (!level) return;
  if (level.background?.bounds && (level.background.url || level.background.data_url)) {
    const { south, west, north, east } = level.background.bounds;
    background = leaflet.imageOverlay(level.background.url || level.background.data_url,
      [[south, west], [north, east]]).addTo(map);
  }
  if (level.area?.corners?.length >= 3) {
    leaflet.polygon(level.area.corners.map(coordinates), {
      color: '#4b7182', fillOpacity: 0.08, weight: 2, interactive: false,
    }).addTo(shapes);
  }
  for (const spot of level.parking_spots) {
    const id = spotId(spot);
    if (id == null) continue;
    const center = leaflet.latLng(coordinates(spot));
    const origin = map.project(center, 0);
    const scale = projectedUnitsPerMeter(map, center.lat) / 2;
    const radians = (spot.rotation_degrees ?? 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const x = spot.width * scale;
    const y = spot.height * scale;
    const corners = [[-x, -y], [x, -y], [x, y], [-x, y]].map(([dx, dy]) =>
      map.unproject(origin.add(leaflet.point(dx * cos - dy * sin, dx * sin + dy * cos)), 0));
    const label = document.createElement('span');
    const indicator = document.createElement('span');
    const title = document.createElement('span');
    label.className = 'parking-viewer__spot-label';
    indicator.className = 'parking-viewer__occupancy';
    indicator.hidden = true;
    label.append(indicator, title);
    const path = leaflet.polygon(corners, { bubblingMouseEvents: false })
      .bindTooltip(label, { direction: 'center', permanent: true })
      .addTo(shapes);
    const details = { id, level: level.level };
    path.on('click', event => emit('spot-click', { ...details, originalEvent: event.originalEvent }));
    path.on('contextmenu', event => emit('spot-context', { ...details, originalEvent: event.originalEvent }));
    path.on('mouseover', () => emit('spot-hover', details));
    path.on('mouseout', () => emit('spot-hover', null));
    const target = path.getElement();
    target?.setAttribute('tabindex', '0');
    target?.setAttribute('role', 'button');
    target?.addEventListener('keydown', event => {
      const contextKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
      if (contextKey || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        emit(contextKey ? 'spot-context' : 'spot-click', { ...details, originalEvent: event });
      }
    });
    paths.set(keyOf(id), { path, title, indicator, name: spot.spot_name ?? String(id) });
  }
  updateAppearance();
  fitLevel();
}

function fitLevel() {
  if (!element.value.clientWidth || !element.value.clientHeight) {
    needsFit = true;
    return;
  }
  needsFit = false;
  const bounds = shapes.getBounds();
  if (background) bounds.extend(background.getBounds());
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 22, animate: false });
}

function updateAppearance() {
  const colors = { available: '#168662', occupied: '#bc3a34', unavailable: '#647481' };
  for (const [id, { path, title, indicator, name }] of paths) {
    const state = Object.hasOwn(props.spotStates, id) ? props.spotStates[id] : undefined;
    const label = state?.label ?? name;
    const color = Object.hasOwn(colors, state?.status) ? colors[state.status] : '#2476a0';
    const highlighted = props.highlightedSpotId != null && keyOf(props.highlightedSpotId) === id;
    const occupied = state?.occupied ?? (state?.status === 'occupied' ? true
      : state?.status === 'available' ? false : undefined);
    const target = path.getElement();
    title.textContent = label;
    target?.setAttribute('aria-label', label);
    indicator.hidden = typeof occupied !== 'boolean';
    if (indicator.hidden) {
      target?.removeAttribute('aria-description');
    } else {
      indicator.dataset.occupancy = occupied ? 'occupied' : 'available';
      target?.setAttribute('aria-description', occupied ? 'Belegt' : 'Frei');
    }
    path.setStyle({ color: highlighted ? '#a85e06' : color, fillColor: color, fillOpacity: 0.35, weight: highlighted ? 4 : 2 });
    path.getTooltip().update();
  }
}

function focusSpot() {
  if (!map || !element.value.clientWidth || props.focusedSpotId == null) return;
  const id = keyOf(props.focusedSpotId);
  if (!paths.has(id)) {
    const level = levels.value.find(item => item.parking_spots.some(spot => keyOf(spotId(spot)) === id));
    if (!level) return;
    changeLevel(level.level);
  }
  const path = paths.get(id)?.path;
  if (path) map.setView(path.getBounds().getCenter(), Math.max(map.getZoom(), 21), { animate: false });
}

watch(() => props.layout, syncLayout);
watch(() => props.focusedSpotId, focusSpot);
watch(() => [props.spotStates, props.highlightedSpotId], updateAppearance, { deep: true });
</script>

<template>
  <section class="parking-viewer">
    <label v-if="levels.length > 1">
      Ebene
      <select :value="levelName" @change="changeLevel($event.target.value)">
        <option v-for="level in levels" :key="level.level">{{ level.level }}</option>
      </select>
    </label>
    <p v-if="failed" role="status">Die Karte konnte nicht geladen werden.</p>
    <p v-else-if="!levels.length" role="status">Für diese Anlage ist kein Lageplan vorhanden.</p>
    <div v-show="levels.length && !failed" ref="element" class="parking-viewer__map" aria-label="Stellplatzkarte" />
  </section>
</template>

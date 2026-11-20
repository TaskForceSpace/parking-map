<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { containsPolygon, isSimplePolygon } from './polygon.js';
import { projectedUnitsPerMeter } from './mapScale.js';

const props = defineProps({
  level: { type: String, default: 'E0' },
  initialLayout: { type: Object, default: null },
  editableSpotNames: { type: Boolean, default: true },
  center: { type: Array, default: () => [49.24, 6.96] },
  tileUrl: { type: String, default: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
  tileAttribution: {
    type: String,
    default: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  tileMaxNativeZoom: { type: Number, default: 19 },
  imageryUrl: {
    type: String,
    default: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  imageryAttribution: {
    type: String,
    default: 'Esri, Maxar, Earthstar Geographics und die GIS User Community',
  },
  imageryMaxNativeZoom: { type: Number, default: 19 },
  searchUrl: { type: String, default: 'https://nominatim.openstreetmap.org/search' },
});

const emit = defineEmits(['change']);
const mapElement = ref(null);
const ready = ref(false);
const mode = ref('navigate');
const primaryLevel = props.level;
const levels = ref([newLevel(primaryLevel)]);
const activeLevelName = ref(primaryLevel);
const levelName = ref('');
const activeLevel = computed(() => levels.value.find(level => level.name === activeLevelName.value));
const area = computed({
  get: () => activeLevel.value.area,
  set: value => { activeLevel.value.area = value; },
});
const spots = computed(() => activeLevel.value.spots);
const drawingPoints = ref([]);
const rotationId = useId();
const selectedName = ref('');
const selected = computed(() => spots.value.find(spot => spot.data.spot_name === selectedName.value));
const popupContent = ref(null);
const spotWidth = ref(2.5);
const spotHeight = ref(5);
const snapEnabled = ref(true);
const spotNamePattern = ref('P???');
const nextNumber = ref(1);
const basemap = computed(() => activeLevel.value.basemap);
const tileMessage = ref('');
const query = ref('');
const results = ref([]);
const loading = ref(false);
const message = ref('');
const searchCache = new Map();
let lastRequest = 0;
let searchController;
let leaflet;
let map;
let layers;
let tiles;
let moveHandle;
let areaHandle;
let spotPopup;
let areaDraft;
let backgroundLayer;
let backgroundRequest = 0;
let mapSizeObserver;
let snapPreview;
let disposed = false;

onMounted(async () => {
  try {
    leaflet = (await import('leaflet')).default;
    if (disposed) return;
    map = leaflet.map(mapElement.value, { maxZoom: 23, worldCopyJump: true })
      .setView(props.center, 21);
    layers = leaflet.featureGroup().addTo(map);
    map.createPane('parking-editor-handles').style.zIndex = '450';
    showBasemap(basemap.value);
    map.on('click', event => {
      selectSpot('');
      if (mode.value === 'area') addAreaPoint(event.latlng);
      if (mode.value === 'place') placeSpot(event.latlng);
    });
    map.on('movestart zoomstart', clearSnapPreview);
    mapSizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    mapSizeObserver.observe(mapElement.value);
    loadInitialLayout();
    ready.value = true;
  } catch {
    message.value = 'Die Karte konnte nicht geladen werden.';
  }
});

function newLevel(name) {
  return { name, area: null, spots: [], basemap: 'street', background: null, view: null };
}

function loadInitialLayout() {
  if (!props.initialLayout?.levels?.length) return;
  const savedLevels = props.initialLayout.levels.map(saved => {
    const level = newLevel(saved.level);
    if (saved.area?.corners?.length >= 3) {
      level.area = createArea(saved.area.corners.map(point => leaflet.latLng(Number(point.latitude), Number(point.longitude))));
    }
    level.spots = saved.parking_spots.map(spot => {
      const center = leaflet.latLng(Number(spot.latitude), Number(spot.longitude));
      return createSpot(geometryAt(center, Number(spot.width), Number(spot.height)), {
        ...spot,
        level: saved.level,
        width: Number(spot.width),
        height: Number(spot.height),
        rotation_degrees: Number(spot.rotation_degrees ?? 0),
        spot_name: spot.spot_name ?? String(spot.id),
      });
    });
    const background = saved.background;
    if (background?.bounds && (background.data_url || background.url)) {
      const { south, west, north, east } = background.bounds;
      level.background = {
        url: background.data_url || background.url,
        bounds: markRaw(leaflet.latLngBounds([[south, west], [north, east]])),
      };
      level.basemap = 'plain';
    }
    return level;
  });
  levels.value = savedLevels;
  activeLevelName.value = savedLevels[0].name;
  renderLevel();
  publish();
}

function switchLevel(name) {
  if (!map || name === activeLevelName.value) return;
  backgroundRequest++;
  selectSpot('');
  changeMode('navigate');
  activeLevel.value.view = { center: map.getCenter(), zoom: map.getZoom() };
  activeLevelName.value = name;
  renderLevel();
}

function renderLevel() {
  layers.clearLayers();
  if (area.value) layers.addLayer(area.value.layer);
  spots.value.forEach(spot => layers.addLayer(spot.layer));
  if (activeLevel.value.view) {
    const { center, zoom } = activeLevel.value.view;
    map.setView(center, zoom, { animate: false });
  } else if (layers.getBounds().isValid()) {
    map.invalidateSize({ pan: false });
    map.fitBounds(layers.getBounds(), { padding: [24, 24], maxZoom: 22, animate: false });
  }
  showBasemap(basemap.value);
}

function addLevel() {
  const name = levelName.value.trim();
  if (!name || levels.value.some(level => level.name.toLowerCase() === name.toLowerCase())) {
    message.value = 'Gib einen eindeutigen Ebenennamen ein.';
    return;
  }
  levels.value.push(newLevel(name));
  levelName.value = '';
  switchLevel(name);
  publish();
}

function showBasemap(value) {
  const aerial = value === 'imagery';
  tiles?.remove();
  tiles = undefined;
  backgroundLayer?.remove();
  backgroundLayer = undefined;
  activeLevel.value.basemap = value;
  tileMessage.value = '';
  if (value === 'plain') {
    const background = activeLevel.value.background;
    if (background) backgroundLayer = leaflet.imageOverlay(background.url, background.bounds).addTo(map);
    return;
  }
  tiles = leaflet.tileLayer(aerial ? props.imageryUrl : props.tileUrl, {
    attribution: aerial ? props.imageryAttribution : props.tileAttribution,
    maxNativeZoom: aerial ? props.imageryMaxNativeZoom : props.tileMaxNativeZoom,
    maxZoom: 23,
  });
  tiles.on('tileerror', () => {
    tileMessage.value = aerial
      ? 'Luftbildkacheln konnten für diesen Ausschnitt nicht vollständig geladen werden.'
      : 'Kartenkacheln konnten für diesen Ausschnitt nicht vollständig geladen werden.';
  });
  tiles.on('loading', () => { tileMessage.value = ''; });
  tiles.addTo(map);
}

async function uploadBackground(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  const level = activeLevel.value;
  const request = ++backgroundRequest;
  const reader = new FileReader();
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error();
    const url = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = url;
    await image.decode();
    if (disposed || request !== backgroundRequest) return;
    const viewport = map.getSize();
    const scale = Math.min(viewport.x / image.naturalWidth, viewport.y / image.naturalHeight) * 0.8;
    const half = leaflet.point(image.naturalWidth, image.naturalHeight).multiplyBy(scale / 2);
    const center = viewport.divideBy(2);
    level.background = {
      url,
      bounds: markRaw(leaflet.latLngBounds(
        map.containerPointToLatLng(center.subtract(half)),
        map.containerPointToLatLng(center.add(half)),
      )),
    };
    showBasemap('plain');
    message.value = '';
    publish();
  } catch {
    if (!disposed && request === backgroundRequest) message.value = 'Das Grundrissbild konnte nicht geladen werden. Verwende PNG, JPEG oder WebP.';
  }
}

function removeBackground() {
  backgroundRequest++;
  activeLevel.value.background = null;
  showBasemap('plain');
  publish();
}

onBeforeUnmount(() => {
  disposed = true;
  mapSizeObserver?.disconnect();
  searchController?.abort();
  map?.remove();
});

async function search() {
  const term = query.value.trim();
  if (!term || loading.value) return;
  message.value = '';
  results.value = [];
  if (searchCache.has(term)) {
    results.value = searchCache.get(term);
    if (!results.value.length) message.value = 'Keine Orte gefunden.';
    return;
  }
  if (Date.now() - lastRequest < 1000) {
    message.value = 'Bitte warte einen Moment vor der nächsten Suche.';
    return;
  }
  loading.value = true;
  lastRequest = Date.now();
  searchController = new AbortController();
  try {
    const url = new URL(props.searchUrl, window.location.href);
    url.searchParams.set('q', term);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    const response = await fetch(url, { signal: searchController.signal });
    if (!response.ok) throw new Error('Search failed');
    results.value = await response.json();
    searchCache.set(term, results.value);
    if (!results.value.length) message.value = 'Keine Orte gefunden.';
  } catch (error) {
    if (error.name !== 'AbortError') message.value = 'Die Ortssuche ist gerade nicht erreichbar.';
  } finally {
    loading.value = false;
  }
}

function goToResult(result) {
  changeMode('navigate');
  map.setView([Number(result.lat), Number(result.lon)], 21);
  results.value = [];
}

function changeMode(value) {
  cancelDrawing();
  clearSnapPreview();
  if (value !== 'edit-area') {
    areaHandle?.remove();
    areaHandle = undefined;
  }
  mode.value = value;
  if (value !== 'navigate') selectSpot('');
  message.value = '';
}

function cancelDrawing() {
  areaDraft?.remove();
  areaDraft = undefined;
  drawingPoints.value = [];
}

function addAreaPoint(point) {
  const previous = drawingPoints.value.at(-1);
  if (previous && map.latLngToContainerPoint(previous).distanceTo(map.latLngToContainerPoint(point)) < 3) return;
  drawingPoints.value.push(markRaw(point));
  if (!areaDraft) {
    areaDraft = leaflet.polygon([], { color: '#e7a019', dashArray: '5 4', interactive: false }).addTo(map);
  }
  areaDraft.setLatLngs(drawingPoints.value);
  message.value = '';
}

function removeAreaPoint() {
  drawingPoints.value.pop();
  areaDraft?.setLatLngs(drawingPoints.value);
  message.value = '';
}

function finishDrawing() {
  const polygon = drawingPoints.value.slice();
  const projected = polygon.map(point => map.project(point, 0));
  if (!isSimplePolygon(projected)) {
    message.value = 'Setze mindestens drei Eckpunkte und vermeide sich kreuzende Kanten.';
    return;
  }
  if (spots.value.some(spot => !containsPolygon(projected, spot.layer.getLatLngs()[0].map(point => map.project(point, 0))))) {
    message.value = 'Der Bereich muss alle bereits gezeichneten Stellplätze umfassen.';
    return;
  }
  if (area.value) layers.removeLayer(area.value.layer);
  area.value = createArea(polygon);
  layers.addLayer(area.value.layer);
  changeMode('place');
  message.value = '';
  publish();
}

function createArea(polygon) {
  const projected = polygon.map(point => map.project(point, 0));
  const geometry = rectangleGeometry(leaflet.latLngBounds(polygon));
  const origin = map.project(geometry.center, 0);
  const unitsPerMeter = projectedUnitsPerMeter(map, geometry.center.lat);
  return {
    ...geometry,
    outline: projected.map(point => {
      const offset = point.subtract(origin);
      return [offset.x / geometry.halfSize.x, offset.y / geometry.halfSize.y];
    }),
    width: 2 * geometry.halfSize.x / unitsPerMeter,
    height: 2 * geometry.halfSize.y / unitsPerMeter,
    layer: markRaw(leaflet.polygon(polygon, {
      color: '#2476b2', fillOpacity: 0.08, interactive: false,
    })),
  };
}

function rectangleGeometry(bounds) {
  const northwest = map.project(bounds.getNorthWest(), 0);
  const southeast = map.project(bounds.getSouthEast(), 0);
  const center = map.unproject(northwest.add(southeast).divideBy(2), 0);
  return {
    center: markRaw(center),
    halfSize: markRaw(southeast.subtract(northwest).divideBy(2)),
    originalLatitude: center.lat,
  };
}

function placeSpot(center) {
  clearSnapPreview();
  const width = Number(spotWidth.value);
  const height = Number(spotHeight.value);
  if (!validSpotSize(width, height)) {
    message.value = 'Gib Breite und Tiefe von mindestens 0,1 m ein.';
    return;
  }
  const snap = findSnap(center, width, height);
  const geometry = snap?.geometry ?? geometryAt(center, width, height);
  const rotation = snap?.rotation ?? 0;
  if (!insideArea(rectangleCorners(geometry, geometry.center, rotation))) {
    message.value = 'Der Stellplatz muss vollständig im markierten Bereich bleiben.';
    return;
  }
  const name = nextSpotName();
  if (!name) return;
  const spot = createSpot(geometry, {
    spot_name: name,
    level: activeLevelName.value,
    width,
    height,
    rotation_degrees: rotation,
  });
  spots.value.push(spot);
  layers.addLayer(spot.layer);
  message.value = '';
  publish();
}

function nextSpotName() {
  const pattern = spotNamePattern.value.trim();
  const placeholder = pattern.match(/\?+/g);
  let number = nextNumber.value;
  if (placeholder?.length !== 1 || !Number.isSafeInteger(number) || number < 0) {
    message.value = 'Gib ein ID-Muster wie BR-? und eine ganze Startnummer ab 0 ein.';
    return;
  }
  const existing = new Set(levels.value.flatMap(level => level.spots.map(spot => spot.data.spot_name)));
  while (Number.isSafeInteger(number)) {
    const name = pattern.replace(placeholder[0], String(number++).padStart(placeholder[0].length, '0'));
    if (existing.has(name)) continue;
    nextNumber.value = number;
    return name;
  }
  message.value = 'Für dieses ID-Muster ist keine weitere Nummer verfügbar.';
}

function findSnap(cursor, width, height, movingSpot) {
  if (!snapEnabled.value) return;

  const cursorPoint = map.project(cursor, 0);
  const draft = geometryAt(cursor, width, height);
  const zoomScale = map.getZoomScale(map.getZoom(), 0);
  let closest;
  let bestDistance = 24 / zoomScale;

  for (const spot of spots.value) {
    if (spot === movingSpot) continue;
    const neighborAngle = spot.data.rotation_degrees;
    const quarterTurns = movingSpot
      ? Math.round((movingSpot.data.rotation_degrees - neighborAngle) / 90)
      : 0;
    const rotation = normalizeAngle(neighborAngle + quarterTurns * 90);
    const axes = movingSpot ? ['x', 'y'] : [spot.data.height >= spot.data.width ? 'x' : 'y'];
    const origin = map.project(spot.center, 0);
    for (const axis of axes) {
      const radians = (neighborAngle + (axis === 'y' ? 90 : 0)) * Math.PI / 180;
      const normal = leaflet.point(Math.cos(radians), Math.sin(radians));
      const draftAxis = quarterTurns % 2 === 0 ? axis : (axis === 'x' ? 'y' : 'x');
      const spacing = spot.halfSize[axis] + draft.halfSize[draftAxis];
      for (const side of [-1, 1]) {
        const point = origin.add(normal.multiplyBy(side * spacing));
        const distance = cursorPoint.distanceTo(point);
        if (distance >= bestDistance) continue;

        const center = map.unproject(point, 0);
        const geometry = geometryAt(center, width, height);
        const flushPoint = origin.add(normal.multiplyBy(side * (spot.halfSize[axis] + geometry.halfSize[draftAxis])));
        geometry.center = markRaw(map.unproject(flushPoint, 0));
        const corners = rectangleCorners(geometry, geometry.center, rotation);
        if (!insideArea(corners) || overlapsAnotherSpot(corners, spot, movingSpot)) continue;

        closest = { geometry, rotation, corners };
        bestDistance = distance;
      }
    }
  }
  return closest;
}

function overlapsAnotherSpot(corners, neighbor, movingSpot) {
  const bounds = leaflet.latLngBounds(corners);
  const points = corners.map(corner => map.project(corner, 0));
  return spots.value.some(spot => {
    if (spot === neighbor || spot === movingSpot || !bounds.overlaps(spot.layer.getBounds())) return false;
    const other = spot.layer.getLatLngs()[0].map(corner => map.project(corner, 0));
    const axes = [points[1].subtract(points[0]), points[3].subtract(points[0]),
      other[1].subtract(other[0]), other[3].subtract(other[0])];
    return axes.every(axis => {
      const unit = axis.divideBy(Math.hypot(axis.x, axis.y));
      const project = point => point.x * unit.x + point.y * unit.y;
      const a = points.map(project);
      const b = other.map(project);
      return Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) > 1e-10;
    });
  });
}

function previewSnap(event) {
  if (mode.value !== 'place' || event.buttons || event.target.closest('.leaflet-interactive, .leaflet-popup, .leaflet-control')
    || !validSpotSize(spotWidth.value, spotHeight.value)) {
    clearSnapPreview();
    return;
  }
  const snap = findSnap(map.mouseEventToLatLng(event), spotWidth.value, spotHeight.value);
  if (!snap) {
    clearSnapPreview();
    return;
  }
  if (snapPreview) {
    snapPreview.setLatLngs(snap.corners);
  } else {
    snapPreview = leaflet.polygon(snap.corners, {
      color: '#ffd36a', weight: 2, dashArray: '5 4', fillOpacity: 0.35, interactive: false,
    }).addTo(map);
  }
}

function clearSnapPreview() {
  snapPreview?.remove();
  snapPreview = undefined;
}

function validSpotSize(width, height) {
  return [width, height].every(value => Number.isFinite(value) && value >= 0.1);
}

function geometryAt(center, width, height) {
  return {
    center: markRaw(center),
    halfSize: markRaw(leaflet.point(width, height).multiplyBy(projectedUnitsPerMeter(map, center.lat) / 2)),
    originalLatitude: center.lat,
  };
}

function spotLabel(name) {
  const label = document.createElement('span');
  label.textContent = name;
  return label;
}

function createSpot(geometry, data) {
  const { center } = geometry;
  const layer = leaflet.polygon(rectangleCorners(geometry, center, data.rotation_degrees), {
    color: '#168662', weight: 2, bubblingMouseEvents: false,
  })
    .bindTooltip(spotLabel(data.spot_name), { permanent: true, direction: 'center' });
  const spot = {
    ...geometry,
    layer: markRaw(layer),
    data: {
      ...data,
      latitude: data.latitude ?? center.lat.toFixed(8),
      longitude: data.longitude ?? center.lng.toFixed(8),
    },
  };
  layer.on('click', event => {
    if (mode.value === 'area') addAreaPoint(event.latlng);
    else if (mode.value !== 'edit-area') selectSpot(spot.data.spot_name);
  });
  return spot;
}

function positionSpotPopup(spot, center = spot.center) {
  spotPopup?.setLatLng([spot.layer.getBounds().getNorth(), center.lng]);
}

function selectSpot(name) {
  selected.value?.layer.setStyle({ color: '#168662', weight: 2 });
  moveHandle?.remove();
  moveHandle = undefined;
  spotPopup?.remove();
  spotPopup = undefined;
  popupContent.value = null;
  selectedName.value = name;
  const spot = selected.value;
  if (!spot) return;

  message.value = '';
  spot.layer.setStyle({ color: '#ffb530', weight: 3 });
  spot.layer.bringToFront();
  moveHandle = leaflet.marker(spot.center, {
    pane: 'parking-editor-handles',
    draggable: true,
    keyboard: false,
    icon: leaflet.divIcon({
      className: 'parking-editor__move-handle',
      html: '✥',
      iconSize: [28, 28],
    }),
  }).bindTooltip('Zum Verschieben ziehen', { direction: 'top' }).addTo(map);
  popupContent.value = document.createElement('div');
  const popup = leaflet.popup({ closeButton: false, autoPan: false, offset: [0, -32] })
    .setLatLng([spot.layer.getBounds().getNorth(), spot.center.lng])
    .setContent(popupContent.value)
    .addTo(map);
  spotPopup = popup;
  nextTick(() => {
    if (spotPopup !== popup) return;
    popup.options.autoPan = true;
    popup.update();
    popup.options.autoPan = false;
  });
  moveHandle.on('drag', () => {
    const center = moveHandle.getLatLng();
    const snap = findSnap(center, spot.data.width, spot.data.height, spot);
    spot.layer.setLatLngs(snap?.corners ?? rectangleCorners(spot, center, spot.data.rotation_degrees));
    positionSpotPopup(spot, snap?.geometry.center ?? center);
  });
  moveHandle.on('dragend', () => {
    const center = moveHandle.getLatLng();
    const snap = findSnap(center, spot.data.width, spot.data.height, spot);
    if (!applyTransform(spot, snap?.geometry.center ?? center, snap?.rotation ?? spot.data.rotation_degrees)) {
      spot.layer.setLatLngs(rectangleCorners(spot, spot.center, spot.data.rotation_degrees));
      positionSpotPopup(spot);
    }
    moveHandle.setLatLng(spot.center);
  });
}

function rectangleCorners(rectangle, center, degrees = 0) {
  const radians = degrees * Math.PI / 180;
  const latitudeScale = Math.cos(rectangle.originalLatitude * Math.PI / 180)
    / Math.cos(center.lat * Math.PI / 180);
  const origin = map.project(center, 0);
  const { x, y } = rectangle.halfSize.multiplyBy(latitudeScale);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const outline = rectangle.outline ?? [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return outline.map(([dx, dy]) => map.unproject(
    origin.add(leaflet.point(dx * x * cosine - dy * y * sine, dx * x * sine + dy * y * cosine)), 0,
  ));
}

function insideArea(corners, rectangle = area.value) {
  if (!rectangle) return false;
  const boundary = rectangleCorners(rectangle, rectangle.center);
  return containsPolygon(boundary.map(point => map.project(point, 0)), corners.map(point => map.project(point, 0)));
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function editArea() {
  changeMode('edit-area');
  areaHandle = leaflet.marker(area.value.center, {
    pane: 'parking-editor-handles',
    draggable: true,
    keyboard: false,
    icon: leaflet.divIcon({
      className: 'parking-editor__move-handle parking-editor__area-handle',
      html: '✥',
      iconSize: [28, 28],
    }),
  }).bindTooltip('Parkfläche verschieben', { direction: 'top' }).addTo(map);
  areaHandle.on('drag', () => {
    const center = areaHandle.getLatLng();
    area.value.layer.setLatLngs(rectangleCorners(area.value, center));
  });
  areaHandle.on('dragend', () => {
    const rectangle = area.value;
    if (!updateArea(areaHandle.getLatLng(), rectangle)) {
      rectangle.layer.setLatLngs(rectangleCorners(rectangle, rectangle.center));
    }
    areaHandle.setLatLng(rectangle.center);
  });
}

function resizeArea(event, dimension) {
  const rectangle = area.value;
  const size = { ...rectangle, [dimension]: event.target.valueAsNumber };
  if (validSpotSize(size.width, size.height)) {
    updateArea(rectangle.center, size);
  } else {
    message.value = 'Gib Länge und Tiefe von mindestens 0,1 m ein.';
  }
  event.target.value = Number(rectangle[dimension].toFixed(2));
}

function updateArea(center, { width, height, outline }) {
  const rectangle = { ...geometryAt(center, width, height), width, height, outline };
  if (!spots.value.every(spot => insideArea(spot.layer.getLatLngs()[0], rectangle))) {
    message.value = 'Die Parkfläche muss alle vorhandenen Stellplätze umfassen.';
    return false;
  }
  Object.assign(area.value, rectangle);
  area.value.layer.setLatLngs(rectangleCorners(rectangle, center));
  message.value = '';
  publish();
  return true;
}

function applyTransform(spot, center, degrees, { width, height } = spot.data) {
  const geometry = geometryAt(center, width, height);
  const corners = rectangleCorners(geometry, center, degrees);
  if (!insideArea(corners)) {
    message.value = 'Der Stellplatz muss vollständig im markierten Bereich bleiben.';
    return false;
  }
  Object.assign(spot, geometry);
  Object.assign(spot.data, {
    latitude: center.lat.toFixed(8),
    longitude: center.lng.toFixed(8),
    rotation_degrees: degrees,
    width,
    height,
  });
  spot.layer.setLatLngs(corners);
  positionSpotPopup(spot);
  message.value = '';
  publish();
  return true;
}

function resizeSpot(event, dimension) {
  const spot = selected.value;
  const size = { ...spot.data, [dimension]: event.target.valueAsNumber };
  if (validSpotSize(size.width, size.height)) {
    applyTransform(spot, spot.center, spot.data.rotation_degrees, size);
  } else {
    message.value = 'Gib Breite und Tiefe von mindestens 0,1 m ein.';
  }
  event.target.value = spot.data[dimension];
}

function renameSpot(event) {
  const spot = selected.value;
  const name = event.target.value.trim();
  if (!name || levels.value.some(level => level.spots.some(other => other !== spot && other.data.spot_name === name))) {
    message.value = 'Gib eine eindeutige Stellplatz-ID ein.';
  } else {
    spot.data.spot_name = name;
    selectedName.value = name;
    spot.layer.setTooltipContent(spotLabel(name));
    message.value = '';
    publish();
  }
  event.target.value = spot.data.spot_name;
}

function rotateSpot(event) {
  const spot = selected.value;
  if (!spot) return;
  const angle = event.target.valueAsNumber;
  if (Number.isFinite(angle)) applyTransform(spot, spot.center, normalizeAngle(angle));
  event.target.value = spot.data.rotation_degrees;
}

function removeSpot(name) {
  const index = spots.value.findIndex(spot => spot.data.spot_name === name);
  if (index < 0) return;
  if (selectedName.value === name) selectSpot('');
  const [spot] = spots.value.splice(index, 1);
  layers.removeLayer(spot.layer);
  message.value = '';
  publish();
}

function undo() {
  removeSpot(spots.value.at(-1)?.data.spot_name);
}

function serializeBounds(bounds) {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

function publish() {
  const serialized = levels.value.map(level => ({
    level: level.name,
    area: level.area ? {
      ...serializeBounds(leaflet.latLngBounds(level.area.layer.getLatLngs()[0])),
      rotation_degrees: 0,
      corners: level.area.layer.getLatLngs()[0]
        .map(({ lat, lng }) => ({ latitude: lat, longitude: lng })),
    } : null,
    parking_spots: level.spots.map(spot => ({ ...spot.data })),
    ...(level.background ? {
      background: { data_url: level.background.url, bounds: serializeBounds(level.background.bounds) },
    } : {}),
  }));
  emit('change', {
    area: serialized[0].area,
    parking_spots: serialized.flatMap(level => level.parking_spots),
    levels: serialized,
  });
}
</script>

<template>
  <div class="parking-editor">
    <div class="parking-editor__workspace">
      <aside class="parking-editor__settings" aria-label="Einstellungen">
        <section class="parking-editor__section">
          <h2>Ebene</h2>
          <form class="parking-editor__stack" @submit.prevent="addLevel">
            <select aria-label="Aktive Ebene" :value="activeLevelName" :disabled="!ready" @change="switchLevel($event.target.value)">
              <option v-for="level in levels" :key="level.name">{{ level.name }}</option>
            </select>
            <div class="parking-editor__row">
              <input v-model="levelName" aria-label="Neue Ebene" placeholder="z. B. UG1" required>
              <button :disabled="!ready" aria-label="Ebene hinzufügen">Hinzufügen</button>
            </div>
          </form>
        </section>

        <section class="parking-editor__section">
          <h2>Hintergrund</h2>
          <div class="parking-editor__segments" aria-label="Kartenansicht">
            <button type="button" :disabled="!ready" :aria-pressed="basemap === 'street'" @click="showBasemap('street')">Straßenkarte</button>
            <button type="button" :disabled="!ready" :aria-pressed="basemap === 'imagery'" @click="showBasemap('imagery')">Luftbild</button>
            <button type="button" :disabled="!ready" :aria-pressed="basemap === 'plain'" @click="showBasemap('plain')">Grundriss</button>
          </div>
          <label class="parking-editor__field">
            Grundrissbild (optional)
            <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="!ready" @change="uploadBackground">
          </label>
          <button v-if="activeLevel.background" type="button" @click="removeBackground">Grundrissbild entfernen</button>
        </section>

        <section class="parking-editor__section">
          <h2>Neue Stellplätze</h2>
          <div class="parking-editor__fields">
            <label class="parking-editor__field">
              Breite (m)
              <input v-model.number="spotWidth" type="number" min="0.1" step="any">
            </label>
            <label class="parking-editor__field">
              Tiefe (m)
              <input v-model.number="spotHeight" type="number" min="0.1" step="any">
            </label>
            <label class="parking-editor__field">
              ID-Muster
              <input v-model="spotNamePattern" type="text" placeholder="BR-?" title="? steht für die nächste Nummer">
            </label>
            <label class="parking-editor__field">
              Nächste Nummer
              <input v-model.number="nextNumber" type="number" min="0" step="1">
            </label>
          </div>
          <label class="parking-editor__check">
            <input v-model="snapEnabled" type="checkbox" @change="clearSnapPreview"> Magnetische Ausrichtung
          </label>
        </section>

        <section v-if="mode === 'edit-area'" class="parking-editor__section">
          <h2>Parkfläche</h2>
          <div class="parking-editor__fields" aria-label="Maße der Parkfläche">
            <label class="parking-editor__field">
              Länge (m)
              <input type="number" min="0.1" step="any" :value="Number(area.width.toFixed(2))" @change="resizeArea($event, 'width')">
            </label>
            <label class="parking-editor__field">
              Tiefe (m)
              <input type="number" min="0.1" step="any" :value="Number(area.height.toFixed(2))" @change="resizeArea($event, 'height')">
            </label>
          </div>
        </section>
      </aside>

      <section class="parking-editor__canvas" aria-label="Karteneditor">
        <div class="parking-editor__canvas-tools">
          <form class="parking-editor__row" @submit.prevent="search">
            <input v-model="query" aria-label="Ort oder Adresse" placeholder="Ort oder Adresse suchen" required>
            <button :disabled="!ready || loading">{{ loading ? 'Suche läuft …' : 'Suchen' }}</button>
          </form>
          <div v-if="results.length" class="parking-editor__stack" aria-label="Suchergebnisse">
            <button v-for="result in results" :key="result.place_id" type="button" @click="goToResult(result)">
              {{ result.display_name }}
            </button>
          </div>
          <div class="parking-editor__actions" aria-label="Kartenwerkzeuge">
            <button type="button" :disabled="!ready" :aria-pressed="mode === 'navigate'" @click="changeMode('navigate')">Karte bewegen</button>
            <button type="button" :disabled="!ready" :aria-pressed="mode === 'area'" @click="changeMode('area')">Bereich markieren</button>
            <button type="button" :disabled="!area" :aria-pressed="mode === 'edit-area'" @click="mode === 'edit-area' ? changeMode('navigate') : editArea()">Parkfläche bearbeiten</button>
            <button type="button" :disabled="!area" :aria-pressed="mode === 'place'" @click="changeMode('place')">Stellplatz platzieren</button>
          </div>
          <div v-if="mode === 'area'" class="parking-editor__actions">
            <button class="parking-editor__primary" type="button" :disabled="drawingPoints.length < 3" @click="finishDrawing">Polygon abschließen</button>
            <button type="button" :disabled="!drawingPoints.length" @click="removeAreaPoint">Letzten Eckpunkt entfernen</button>
          </div>
        </div>

        <div class="parking-editor__viewport" @keydown.esc="changeMode('navigate')">
          <div
            ref="mapElement"
            class="parking-editor__map"
            :class="{ 'parking-editor__map--drawing': mode === 'area' }"
            aria-label="Karte"
            @pointermove="previewSnap"
            @pointerleave="clearSnapPreview"
          />
        </div>
        <div class="parking-editor__canvas-footer">
          <div class="parking-editor__stack">
            <output aria-live="polite">{{ (!selected && message) || (mode === 'area' ? 'Setze die Eckpunkte per Klick und schließe das Polygon ab.' : mode === 'edit-area' ? 'Ziehe den Griff in der Mitte, um die Parkfläche zu verschieben.' : mode === 'place' ? 'Klicke auf freie Fläche zum Platzieren oder auf einen Stellplatz zum Bearbeiten.' : '') }}</output>
            <span v-if="tileMessage" role="status">{{ tileMessage }}</span>
          </div>
          <button v-if="spots.length" type="button" @click="undo">Letzten Stellplatz entfernen</button>
        </div>
      </section>
    </div>

    <Teleport v-if="selected && popupContent" :to="popupContent">
      <section class="parking-editor__spot-dialog" role="dialog" :aria-label="'Stellplatz ' + selectedName">
        <div class="parking-editor__spot-dialog-header">
          <strong>{{ selectedName }}</strong>
          <button type="button" aria-label="Stellplatzdialog schließen" @click="selectSpot('')">×</button>
        </div>
        <p>Zum Verschieben den Griff am Stellplatz ziehen.</p>
        <label v-if="editableSpotNames">
          Stellplatz-ID
          <input type="text" :value="selected.data.spot_name" @change="renameSpot">
        </label>
        <div class="parking-editor__spot-dimensions">
          <label>
            Breite (m)
            <input type="number" min="0.1" step="any" :value="selected.data.width" @change="resizeSpot($event, 'width')">
          </label>
          <label>
            Tiefe (m)
            <input type="number" min="0.1" step="any" :value="selected.data.height" @change="resizeSpot($event, 'height')">
          </label>
        </div>
        <label :for="rotationId">Drehung (°)</label>
        <input :id="rotationId" type="number" step="any" :value="selected.data.rotation_degrees" @change="rotateSpot">
        <button type="button" @click="removeSpot(selectedName)">Stellplatz löschen</button>
        <p v-if="message" role="status">{{ message }}</p>
      </section>
    </Teleport>

  </div>
</template>

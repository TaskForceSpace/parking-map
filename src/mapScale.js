export function projectedUnitsPerMeter(map, latitude) {
  return map.options.crs.scale(0) / (2 * Math.PI * 6371000 * Math.cos(latitude * Math.PI / 180));
}

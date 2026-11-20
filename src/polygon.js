const EPSILON = 1e-11;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const edges = points => points.map((point, index) => [point, points[(index + 1) % points.length]]);

function intersections(start, end, a, b) {
  const vector = end.subtract(start);
  const edge = b.subtract(a);
  const offset = a.subtract(start);
  const length = Math.hypot(vector.x, vector.y);
  const edgeLength = Math.hypot(edge.x, edge.y);
  const determinant = cross(vector, edge);
  if (Math.abs(determinant) <= EPSILON * Math.max(length, edgeLength)) {
    if (Math.abs(cross(vector, offset)) > EPSILON * length) return [];
    const squared = dot(vector, vector);
    const t = dot(offset, vector) / squared;
    const u = dot(b.subtract(start), vector) / squared;
    const first = Math.max(0, Math.min(t, u));
    const last = Math.min(1, Math.max(t, u));
    return first <= last ? [first, last] : [];
  }

  const t = cross(offset, edge) / determinant;
  const u = cross(offset, vector) / determinant;
  const tolerance = EPSILON / length;
  const edgeTolerance = EPSILON / edgeLength;
  return t >= -tolerance && t <= 1 + tolerance && u >= -edgeTolerance && u <= 1 + edgeTolerance
    ? [Math.max(0, Math.min(1, t))]
    : [];
}

export function isSimplePolygon(points) {
  if (points.length < 3) return false;
  const outline = edges(points);
  const anchor = points[0];
  const signedArea = outline.reduce((sum, [a, b]) => sum + cross(a.subtract(anchor), b.subtract(anchor)), 0);
  return Math.abs(signedArea) > EPSILON ** 2
    && outline.every(([a, b], i) => a.distanceTo(b) > EPSILON
      && outline.slice(i + 2).every(([c, d], offset) =>
        (i === 0 && i + 2 + offset === outline.length - 1) || !intersections(a, b, c, d).length));
}

function containsPoint(point, outline) {
  let inside = false;
  for (const [a, b] of outline) {
    const edge = b.subtract(a);
    const offset = point.subtract(a);
    const length = Math.hypot(edge.x, edge.y);
    if (Math.abs(cross(edge, offset)) <= EPSILON * length
      && dot(offset, edge) >= -EPSILON * length
      && dot(point.subtract(b), edge) <= EPSILON * length) return true;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < a.x + (b.x - a.x) * (point.y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

export function containsPolygon(boundary, points) {
  const outline = edges(boundary);
  if (!points.every(point => containsPoint(point, outline))) return false;

  return edges(points).every(([a, b]) => {
    const cuts = [0, 1, ...outline.flatMap(([c, d]) => intersections(a, b, c, d))]
      .sort((first, second) => first - second);
    const vector = b.subtract(a);
    return cuts.slice(1).every((t, index) =>
      containsPoint(a.add(vector.multiplyBy((cuts[index] + t) / 2)), outline));
  });
}

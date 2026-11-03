let clipboard = [];

export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

export function pathToSvg(points) {
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i += 1) {
    const intersects = ((polygon[i].y > point.y) !== (polygon[j].y > point.y))
      && point.x < ((polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)) / (polygon[j].y - polygon[i].y) + polygon[i].x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pathIsSelected(path, polygon) {
  return path.points.some(point => isPointInPolygon(point, polygon))
    || path.points.some((point, index) => index > 0 && distanceToSegment(polygon[0], point, path.points[index - 1]) < 12);
}

export function boundsForPaths(paths) {
  const points = paths.flatMap(path => path.points);
  if (!points.length) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function transformPaths(paths, transform) {
  const bounds = boundsForPaths(paths);
  if (!bounds) return paths;
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return paths.map(path => ({
    ...path,
    points: path.points.map(point => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const angle = transform.rotation || 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: center.x + (dx * cos - dy * sin) * (transform.scale || 1) + (transform.x || 0),
        y: center.y + (dx * sin + dy * cos) * (transform.scale || 1) + (transform.y || 0),
      };
    }),
  }));
}

export function eraseAtPoint(paths, point, radius = 22) {
  return paths.filter(path => !path.points.some((item, index) => index === 0
    ? Math.hypot(item.x - point.x, item.y - point.y) < radius
    : distanceToSegment(point, path.points[index - 1], item) < radius));
}

export function copyPaths(paths) {
  clipboard = JSON.parse(JSON.stringify(paths));
}

export function pastePaths() {
  return clipboard.map(path => ({
    ...path,
    id: `${Date.now()}-${Math.random()}`,
    points: path.points.map(point => ({ x: point.x + 24, y: point.y + 24 })),
  }));
}

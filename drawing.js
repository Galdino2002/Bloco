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

function pointOnSegment(point, start, end) {
  const cross = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > 1e-8) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared;
}

export function isPointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    if (pointOnSegment(point, previous, current)) return true;
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x)
    && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (Math.abs(abC) <= 1e-8 && onSegment(a, c, b))
    || (Math.abs(abD) <= 1e-8 && onSegment(a, d, b))
    || (Math.abs(cdA) <= 1e-8 && onSegment(c, a, d))
    || (Math.abs(cdB) <= 1e-8 && onSegment(c, b, d));
}

export function pathIntersectsPolygon(path, polygon) {
  const points = Array.isArray(path?.points) ? path.points : [];
  if (!points.length || !Array.isArray(polygon) || polygon.length < 3) return false;
  if (points.some(point => isPointInPolygon(point, polygon))) return true;

  const pathBounds = {
    minX: Math.min(...points.map(point => point.x)),
    maxX: Math.max(...points.map(point => point.x)),
    minY: Math.min(...points.map(point => point.y)),
    maxY: Math.max(...points.map(point => point.y)),
  };
  const polygonBounds = {
    minX: Math.min(...polygon.map(point => point.x)),
    maxX: Math.max(...polygon.map(point => point.x)),
    minY: Math.min(...polygon.map(point => point.y)),
    maxY: Math.max(...polygon.map(point => point.y)),
  };
  if (pathBounds.maxX < polygonBounds.minX || pathBounds.minX > polygonBounds.maxX
    || pathBounds.maxY < polygonBounds.minY || pathBounds.minY > polygonBounds.maxY) return false;

  for (let i = 1; i < points.length; i += 1) {
    for (let j = 0; j < polygon.length; j += 1) {
      if (segmentsIntersect(points[i - 1], points[i], polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
}

export function screenToDocument(point, transform = {}) {
  const zoom = transform.zoom || 1;
  const pan = transform.pan || { x: 0, y: 0 };
  const origin = transform.origin || { x: 0, y: 0 };
  return {
    x: (point.x - origin.x - pan.x) / zoom + origin.x,
    y: (point.y - origin.y - pan.y) / zoom + origin.y,
  };
}

export function documentToScreen(point, transform = {}) {
  const zoom = transform.zoom || 1;
  const pan = transform.pan || { x: 0, y: 0 };
  const origin = transform.origin || { x: 0, y: 0 };
  return {
    x: (point.x - origin.x) * zoom + origin.x + pan.x,
    y: (point.y - origin.y) * zoom + origin.y + pan.y,
  };
}

export function getHighlighterStyle(type = 'classic', width = 18) {
  const opacity = type === 'pastel' ? 0.22
    : type === 'underline' ? 0.95
      : type === 'bold' ? 0.58
        : 0.32;
  return { width, opacity };
}

export function pathIsSelected(path, polygon) {
  return pathIntersectsPolygon(path, polygon);
}

export function boundsForPaths(paths) {
  const points = (Array.isArray(paths) ? paths : []).flatMap(path => Array.isArray(path?.points) ? path.points : []);
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
  return paths.flatMap(path => {
    const points = path.points || [];
    if (points.length < 2) {
      return points.length && Math.hypot(points[0].x - point.x, points[0].y - point.y) >= radius ? [path] : [];
    }
    const chunks = [];
    let chunk = [];
    const flush = () => {
      if (chunk.length) chunks.push({ ...path, id: chunks.length ? `${path.id}-${chunks.length}` : path.id, points: chunk });
      chunk = [];
    };
    points.forEach((current, index) => {
      const previous = points[index - 1];
      const touched = index === 0
        ? Math.hypot(current.x - point.x, current.y - point.y) < radius
        : distanceToSegment(point, previous, current) < radius;
      if (touched) {
        flush();
      } else {
        if (!chunk.length && previous && Math.hypot(previous.x - point.x, previous.y - point.y) >= radius) chunk.push(previous);
        chunk.push(current);
      }
    });
    flush();
    return chunks.filter(item => item.points.length > 1 || Math.hypot(item.points[0].x - point.x, item.points[0].y - point.y) >= radius);
  });
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

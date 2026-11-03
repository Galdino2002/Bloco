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

function segmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x)
    && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)) return true;
  return (abC === 0 && onSegment(a, c, b))
    || (abD === 0 && onSegment(a, d, b))
    || (cdA === 0 && onSegment(c, a, d))
    || (cdB === 0 && onSegment(c, b, d));
}

export function pathIntersectsPolygon(path, polygon) {
  if (!path?.points?.length || polygon.length < 3) return false;
  if (path.points.some(point => isPointInPolygon(point, polygon))) return true;
  for (let i = 1; i < path.points.length; i += 1) {
    for (let j = 0; j < polygon.length; j += 1) {
      if (segmentsIntersect(path.points[i - 1], path.points[i], polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
}

export function pathIsSelected(path, polygon) {
  return pathIntersectsPolygon(path, polygon);
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

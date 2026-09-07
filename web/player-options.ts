export function rotatedDirection(key: string, rotation: number): string {
  const directions = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
  const index = directions.indexOf(key);
  return index < 0 ? key : directions[(index - rotation + 4) % 4];
}
/** Invert a clockwise CSS rotation using normalized coordinates in its bounding box. */
export function screenPoint(x: number, y: number, width: number, height: number, rotation: number): [number, number] {
  const [u, v] = rotation === 1 ? [y, 1 - x] : rotation === 2 ? [1 - x, 1 - y] : rotation === 3 ? [1 - y, x] : [x, y];
  return [Math.max(0, Math.min(width - 1, Math.floor(u * width))), Math.max(0, Math.min(height - 1, Math.floor(v * height)))];
}
export function clockSlices(elapsedMs: number, speed: number): number[] {
  let remaining = Math.max(0, Math.min(100, elapsedMs)) * speed;
  const slices: number[] = [];
  while (remaining > 0) { const slice = Math.min(20, remaining); slices.push(slice); remaining -= slice; }
  return slices;
}

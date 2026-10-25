export function historicalPhotoUrls(values: Array<string | null>): string[] {
  const urls = new Set<string>();
  const add = (value: unknown, depth = 0) => {
    if (depth > 3 || urls.size >= 20) return;
    if (Array.isArray(value)) { value.slice(0, 20).forEach(item => add(item, depth + 1)); return; }
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (text.startsWith('[')) { try { add(JSON.parse(text), depth + 1); } catch {} return; }
    if (/^https:\/\/[^\s]+$/i.test(text) || /^\/[^/\s][^\s]*$/.test(text)) urls.add(text);
  };
  values.forEach(value => add(value));
  return [...urls];
}

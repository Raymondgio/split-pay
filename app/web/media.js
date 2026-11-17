// Photos (stored apart from the main data) and image making for sharing.

const DB = 'splitpay';
export function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
      if (!r.result.objectStoreNames.contains('photos')) r.result.createObjectStore('photos');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvPut = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const photoGet = (id) => tx('photos', 'readonly', (s) => s.get(id));
export const photoPut = (id, data) => tx('photos', 'readwrite', (s) => s.put(data, id));
export const photoDel = (id) => tx('photos', 'readwrite', (s) => s.delete(id));
export async function photoAll() {
  const db = await idb();
  return new Promise((res, rej) => {
    const out = {};
    const q = db.transaction('photos').objectStore('photos').openCursor();
    q.onsuccess = () => { const c = q.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
    q.onerror = () => rej(q.error);
  });
}
export async function photoReplaceAll(map) {
  await tx('photos', 'readwrite', (s) => { s.clear(); for (const [k, v] of Object.entries(map || {})) s.put(v, k); });
}

/** Shrink a camera photo to at most 1280 px and JPEG quality 0.72. */
export async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draw a balance summary as a PNG.
 * lines: [{ text, amount, tone: 'pos' | 'neg' | '' }]
 */
export async function summaryImage(title, subtitle, lines) {
  try { await document.fonts.load('700 40px "Space Grotesk"'); } catch { /* fall back to system font */ }
  const F = '"Space Grotesk", system-ui, sans-serif';
  const W = 1080, pad = 72, rowH = 92;
  const H = pad + 120 + 60 + Math.max(1, lines.length) * rowH + 140;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0E0F11'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#C8F135'; g.fillRect(pad, pad, 72, 10);
  g.fillStyle = '#F4F5F2'; g.font = `700 64px ${F}`; g.textBaseline = 'top';
  g.fillText(title, pad, pad + 40, W - pad * 2);
  g.fillStyle = '#8B9096'; g.font = `400 34px ${F}`;
  g.fillText(subtitle, pad, pad + 124, W - pad * 2);
  let y = pad + 200;
  if (!lines.length) { g.fillStyle = '#C8F135'; g.font = `700 44px ${F}`; g.fillText('Everyone is settled up', pad, y + 20); }
  for (const l of lines) {
    g.fillStyle = '#272A30'; g.fillRect(pad, y, W - pad * 2, 2);
    g.fillStyle = '#F4F5F2'; g.font = `500 38px ${F}`; g.textBaseline = 'middle';
    g.fillText(l.text, pad, y + rowH / 2, W - pad * 2 - 330);
    g.fillStyle = l.tone === 'pos' ? '#C8F135' : l.tone === 'neg' ? '#FF8A5B' : '#F4F5F2';
    g.font = `700 40px ${F}`; g.textAlign = 'right';
    g.fillText(l.amount, W - pad, y + rowH / 2);
    g.textAlign = 'left';
    y += rowH;
  }
  g.fillStyle = '#8B9096'; g.font = `400 30px ${F}`; g.textBaseline = 'alphabetic';
  g.fillText('Made with Split Pay', pad, H - pad + 10);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

/** Share a file with the phone's share sheet; download it when that is not possible. */
export async function shareFile(blob, name, type) {
  const file = new File([blob], name, { type });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared'; }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return 'downloaded';
}

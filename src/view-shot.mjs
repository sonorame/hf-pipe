export const LIVE_MAX_MS = 1000;
export const LIVE_MAXW = 1600;
export const LIVE_QUALITY = 22;

export function normalizeScreens(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.value)) return raw.value;
  if (raw && typeof raw === "object") {
    const vals = Object.values(raw).filter(
      (v) => v && typeof v === "object" && (Number.isFinite(Number(v.width)) || Number.isFinite(Number(v.Width)))
    );
    if (vals.length) return vals;
  }
  return [];
}

export function selectDisplay(screens, index) {
  const list = normalizeScreens(screens);
  const i = Number(index);
  if (Number.isInteger(i) && i >= 0 && i < list.length) return list[i];
  return (
    list.find((s) => s && s.primary) ||
    list[0] || {
      i: 0,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      primary: true,
    }
  );
}

export function liveShotQuery(display, opts = {}) {
  const d = Math.max(0, Number(display) || 0);
  const maxw = Math.min(1920, Math.max(640, Math.floor(Number(opts.maxw) || LIVE_MAXW)));
  const quality = Math.min(40, Math.max(14, Math.floor(Number(opts.quality) || LIVE_QUALITY)));
  return {
    display: d,
    maxw,
    quality,
    path: `/shot?display=${d}&maxw=${maxw}&q=${quality}`,
  };
}

export function mapPointer(ev, rect, geom, natural) {
  const nw = Math.max(1, Number(natural?.width) || Number(rect?.width) || 1);
  const nh = Math.max(1, Number(natural?.height) || Number(rect?.height) || 1);
  const rw = Math.max(1, Number(rect?.width) || 1);
  const rh = Math.max(1, Number(rect?.height) || 1);
  const scale = Math.min(rw / nw, rh / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const ox = Number(rect?.left) + (rw - dw) / 2;
  const oy = Number(rect?.top) + (rh - dh) / 2;
  const px = (Number(ev?.clientX) - ox) / Math.max(1e-6, dw);
  const py = (Number(ev?.clientY) - oy) / Math.max(1e-6, dh);
  const cx = Math.min(1, Math.max(0, px));
  const cy = Math.min(1, Math.max(0, py));
  const left = Number(geom?.left) || 0;
  const top = Number(geom?.top) || 0;
  const width = Number(geom?.width) || 1;
  const height = Number(geom?.height) || 1;
  return { x: left + cx * width, y: top + cy * height };
}

export function parseShotQuery(url) {
  const u = new URL(String(url || ""), "http://127.0.0.1");
  const fallback = liveShotQuery(0);
  const display = Number(u.searchParams.get("display"));
  const maxw = Number(u.searchParams.get("maxw"));
  const quality = Number(u.searchParams.get("q"));
  return {
    display: Number.isFinite(display) && display >= 0 ? Math.floor(display) : 0,
    maxw: Number.isFinite(maxw) && maxw > 0 ? Math.floor(maxw) : fallback.maxw,
    quality: Number.isFinite(quality) && quality > 0 ? Math.floor(quality) : fallback.quality,
  };
}

export function screensHeader(screens) {
  const list = normalizeScreens(screens);
  return list
    .map((s, i) => {
      const idx = Number.isInteger(s?.i) ? s.i : i;
      const w = Number(s?.width) || 0;
      const h = Number(s?.height) || 0;
      const p = s?.primary ? "p" : "";
      return `${idx}:${w}x${h}${p}`;
    })
    .join(",");
}

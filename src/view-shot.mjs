export const LIVE_MAX_MS = 1000;
export const LIVE_MAXW = 960;
export const LIVE_QUALITY = 22;

export function selectDisplay(screens, index) {
  const list = Array.isArray(screens) ? screens : [];
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

export function liveShotQuery(display) {
  const d = Math.max(0, Number(display) || 0);
  return {
    display: d,
    maxw: LIVE_MAXW,
    quality: LIVE_QUALITY,
    path: `/shot?display=${d}&maxw=${LIVE_MAXW}&q=${LIVE_QUALITY}`,
  };
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
  const list = Array.isArray(screens) ? screens : [];
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

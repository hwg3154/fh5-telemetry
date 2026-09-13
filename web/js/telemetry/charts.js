// Canvas charts for the telemetry screen: line traces, G-G diagram and the
// top-down position trail.

import { G } from '../units.js';

const MAX_DPR = 2;
const GRID = 'rgba(255,255,255,0.07)';
const LABEL = '#6a6e77';
const LABEL_FONT = '10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Sizes the backing store to the element and returns a CSS-pixel context.
function fit(canvas) {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const w = Math.round(cw * dpr);
  const h = Math.round(ch * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  return { ctx, w: cw, h: ch };
}

function label(ctx, str, x, y, align = 'left', baseline = 'middle', color = LABEL) {
  ctx.font = LABEL_FONT;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

// series: [{ ring, color, min, max, width }]. The newest sample is at the right
// edge and the full ring capacity spans the width, so the time axis is fixed.
// guides: [{ value, label, color }] in the first series' units.
export function drawLines(canvas, series, { guides = [], topLabel = '', bottomLabel = '', seconds = 20 } = {}) {
  const f = fit(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const x0 = 34, x1 = w - 4, y0 = 6, y1 = h - 16;
  const pw = x1 - x0, ph = y1 - y0;

  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = Math.round(y0 + (ph * i) / 4) + 0.5;
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  for (let s = 0; s <= seconds; s += 5) {
    const x = Math.round(x1 - (pw * s) / seconds) + 0.5;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  ctx.stroke();
  for (let s = 5; s <= seconds; s += 5) label(ctx, `-${s}s`, x1 - (pw * s) / seconds, h - 2, 'center', 'bottom');
  if (topLabel) label(ctx, topLabel, x0 - 4, y0 + 4, 'right');
  if (bottomLabel) label(ctx, bottomLabel, x0 - 4, y1 - 2, 'right');

  const s0 = series[0];
  for (const g of guides) {
    const y = y1 - ((g.value - s0.min) / (s0.max - s0.min)) * ph;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = g.color || '#8b8f99';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.setLineDash([]);
    if (g.label) label(ctx, g.label, x0 - 4, y, 'right');
  }

  ctx.lineJoin = 'round';
  for (const s of series) {
    const r = s.ring;
    const n = r.len;
    if (n < 2) continue;
    const step = Math.max(1, Math.floor(r.cap / pw));
    const span = s.max - s.min;
    ctx.beginPath();
    for (let i = n - 1, first = true; i >= 0; i -= step, first = false) {
      const x = x1 - ((n - 1 - i) / (r.cap - 1)) * pw;
      let k = (r.at(i) - s.min) / span;
      k = k < -0.02 ? -0.02 : k > 1.02 ? 1.02 : k;
      const y = y1 - k * ph;
      if (first) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = s.width || 1.5;
    ctx.strokeStyle = s.color;
    ctx.stroke();
  }
}

// Friction circle: lateral on X (right positive), longitudinal on Y
// (acceleration up, braking down), last ~2 s as a fading trail.
export function drawGG(canvas, hist, maxG = 2) {
  const f = fit(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const cx = w / 2, cy = h / 2;
  const k = (Math.min(w, h) / 2 - 14) / maxG;

  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (const g of [0.5, 1, 1.5, 2]) {
    ctx.moveTo(cx + g * k, cy);
    ctx.arc(cx, cy, g * k, 0, Math.PI * 2);
  }
  ctx.moveTo(cx - maxG * k, cy);
  ctx.lineTo(cx + maxG * k, cy);
  ctx.moveTo(cx, cy - maxG * k);
  ctx.lineTo(cx, cy + maxG * k);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.arc(cx, cy, k, 0, Math.PI * 2);
  ctx.stroke();
  for (const g of [0.5, 1, 1.5, 2]) label(ctx, g.toFixed(1), cx + g * k * 0.7071 + 2, cy - g * k * 0.7071 - 2, 'left', 'bottom');
  label(ctx, 'ACCEL', cx, 2, 'center', 'top');
  label(ctx, 'BRAKE', cx, h - 2, 'center', 'bottom');
  label(ctx, 'L', 4, cy - 8, 'left');
  label(ctx, 'R', w - 4, cy - 8, 'right');

  const lat = hist.gLat, lon = hist.gLon;
  const n = lat.len;
  const trail = Math.min(n, 120);
  if (trail < 2) return;
  const chunks = 6;
  const per = Math.ceil(trail / chunks);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (let c = 0; c < chunks; c++) {
    const start = n - trail + c * per;
    const end = Math.min(n - 1, start + per);
    if (start >= end) continue;
    ctx.beginPath();
    for (let i = start; i <= end; i++) {
      const x = cx + lat.at(i) * k;
      const y = cy - lon.at(i) * k;
      if (i === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(255,69,58,${0.12 + (0.7 * (c + 1)) / chunks})`;
    ctx.stroke();
  }
  const x = cx + lat.last() * k;
  const y = cy - lon.last() * k;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff453a';
  ctx.fill();
  label(ctx, `${Math.hypot(lat.last(), lon.last()).toFixed(2)} g`, w - 4, h - 2, 'right', 'bottom', '#c9ccd3');
}

// Top-down X/Z path (north up), auto-scaled with equal aspect.
export function drawTrail(canvas, hist, metric) {
  const f = fit(canvas);
  if (!f) return;
  const { ctx, w, h } = f;
  const xs = hist.trailX, zs = hist.trailZ;
  const n = xs.len;
  if (n < 2) {
    label(ctx, 'Waiting for position data', w / 2, h / 2, 'center');
    return;
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs.at(i), z = zs.at(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 50);
  const pad = 14;
  const k = (Math.min(w, h) - pad * 2) / span;
  const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
  const px = (x) => w / 2 + (x - mx) * k;
  const pz = (z) => h / 2 - (z - mz) * k;

  const recent = Math.max(0, n - 300);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(px(xs.at(i)), pz(zs.at(i)));
    else ctx.lineTo(px(xs.at(i)), pz(zs.at(i)));
  }
  ctx.strokeStyle = 'rgba(61,139,255,0.35)';
  ctx.stroke();
  ctx.beginPath();
  for (let i = recent; i < n; i++) {
    if (i === recent) ctx.moveTo(px(xs.at(i)), pz(zs.at(i)));
    else ctx.lineTo(px(xs.at(i)), pz(zs.at(i)));
  }
  ctx.strokeStyle = '#3d8bff';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px(xs.last()), pz(zs.last()), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  const spanLabel = metric ? `${Math.round(span)} m` : `${Math.round(span * 3.28084)} ft`;
  label(ctx, `N ↑   span ${spanLabel}`, 4, h - 2, 'left', 'bottom');
}

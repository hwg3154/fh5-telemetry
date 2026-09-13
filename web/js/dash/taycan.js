// Porsche Taycan inspired: flat, minimal and digital. Three round pods on
// black glass: power meter and battery on the left, tachometer ring with
// digital speed in the centre, G-meter on the right.

import { FONTS, font, roundRect, tickPath, text, blink, clamp, DEG, TAU, memo, gFelt } from './common.js';
import { lapTime } from '../units.js';

const WHITE = '#f3f5f6';
const DIM = '#7b828a';
const FAINT = '#30353a';
const TRACK = '#15181b';
const ACID = '#3ee6a8';
const REGEN = '#3d8bff';
const AMBER = '#ffb020';
const RED = '#ff3b30';
const A0 = 135 * DEG;
const A1 = 405 * DEG;
const P_MIN = -0.25; // the power meter reaches below zero for engine braking
const G_MAX = 1.5;
const RING = 0.86;

const fmtCur = memo(lapTime);
const fmtBest = memo(lapTime);

const lerpA = (a0, a1, f) => a0 + (a1 - a0) * clamp(f, 0, 1);
const thin = (px, weight) => font(Math.round(px), FONTS.thin, weight);

function pod(ctx, p) {
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r, 0, TAU);
  ctx.fillStyle = '#060708';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1e2226';
  ctx.stroke();
}

// Arc on a pod's ring between two angles, given in either order.
function ring(ctx, p, a0, a1, color) {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  if (hi - lo < 0.003) return;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r * RING, lo, hi);
  ctx.lineWidth = p.r * 0.05;
  ctx.strokeStyle = color;
  ctx.stroke();
}

export default {
  id: 'taycan',
  name: 'Porsche Taycan',
  bg: '#000',

  layout(W, H) {
    const m = 30, gap = 28;
    const Rc = Math.min(clamp((W - 2 * m - 2 * gap) / 4.9, 220, 350), 0.4 * H);
    const Rs = Rc * 0.725;
    const cx = W / 2, cy = 410;
    const dx = Rc + gap + Rs;
    const left = { cx: cx - dx, cy, r: Rs };
    return {
      center: { cx, cy, r: Rc },
      left,
      right: { cx: cx + dx, cy, r: Rs },
      battery: { x: left.cx - Rs * 0.28, y: cy + Rs * 0.22, w: Rs * 0.53, h: Rs * 0.15 },
      infoY: Math.min(H - 40, cy + Rc + 70),
    };
  },

  drawStatic(ctx, L, v) {
    const { center: c, left: l, right: r, view } = L;
    const sc = v.scale;

    ctx.fillStyle = '#000';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    for (const p of [l, c, r]) pod(ctx, p);

    // Centre: tach ring tinted past the redline, major marks and numerals inside it
    const redA = lerpA(A0, A1, sc.redline / sc.max);
    ring(ctx, c, A0, redA, TRACK);
    ring(ctx, c, redA, A1, '#2a1114');
    ctx.beginPath();
    for (let rpm = 0; rpm <= sc.max + 1; rpm += sc.major) tickPath(ctx, c.cx, c.cy, c.r * 0.79, c.r * 0.81, lerpA(A0, A1, rpm / sc.max));
    ctx.lineWidth = 2;
    ctx.strokeStyle = FAINT;
    ctx.stroke();
    for (let rpm = 0; rpm <= sc.max + 1; rpm += sc.major) {
      const a = lerpA(A0, A1, rpm / sc.max);
      text(ctx, String(rpm / 1000), c.cx + Math.cos(a) * c.r * 0.72, c.cy + Math.sin(a) * c.r * 0.72, thin(c.r * 0.072, 500), rpm >= sc.redline ? RED : DIM);
    }
    roundRect(ctx, c.cx - c.r * 0.11, c.cy - c.r * 0.5, c.r * 0.22, c.r * 0.14, c.r * 0.07);
    ctx.lineWidth = 2;
    ctx.strokeStyle = FAINT;
    ctx.stroke();
    text(ctx, v.speedUnit, c.cx, c.cy + c.r * 0.25, thin(c.r * 0.065, 500), DIM);
    text(ctx, 'RPM', c.cx, c.cy + c.r * 0.87, thin(c.r * 0.05, 600), DIM);

    // Left: power meter ring with a zero mark, battery outline
    ring(ctx, l, A0, A1, TRACK);
    const zeroA = lerpA(A0, A1, -P_MIN / (1 - P_MIN));
    ctx.beginPath();
    tickPath(ctx, l.cx, l.cy, l.r * 0.79, l.r * 0.93, zeroA);
    ctx.lineWidth = 2;
    ctx.strokeStyle = DIM;
    ctx.stroke();
    text(ctx, 'POWER', l.cx, l.cy - l.r * 0.5, thin(l.r * 0.065, 600), DIM);
    const b = L.battery;
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h * 0.3);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4a5056';
    ctx.stroke();
    ctx.fillStyle = '#4a5056';
    ctx.fillRect(b.x + b.w + 3, b.y + b.h * 0.3, b.h * 0.2, b.h * 0.4);
    text(ctx, 'BOOST', l.cx, l.cy + l.r * 0.88, thin(l.r * 0.065, 600), DIM);

    // Right: G-meter rings inside a ring for total g
    ring(ctx, r, A0, A1, TRACK);
    const k = (r.r * 0.62) / G_MAX;
    ctx.beginPath();
    for (const g of [0.5, 1.5]) {
      ctx.moveTo(r.cx + g * k, r.cy);
      ctx.arc(r.cx, r.cy, g * k, 0, TAU);
    }
    ctx.moveTo(r.cx - G_MAX * k, r.cy);
    ctx.lineTo(r.cx + G_MAX * k, r.cy);
    ctx.moveTo(r.cx, r.cy - G_MAX * k);
    ctx.lineTo(r.cx, r.cy + G_MAX * k);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#1b1f23';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r.cx, r.cy, k, 0, TAU);
    ctx.strokeStyle = FAINT;
    ctx.stroke();
    text(ctx, '1 g', r.cx + k * 0.82, r.cy - k * 0.82, thin(r.r * 0.05, 500), DIM);
    text(ctx, 'G-FORCE', r.cx, r.cy + r.r * 0.88, thin(r.r * 0.065, 600), DIM);
  },

  drawDynamic(ctx, L, v) {
    const { center: c, left: l, right: r } = L;
    const sc = v.scale;

    // Tach ring: white up to the redline, red beyond it, all red on the limiter
    const redA = lerpA(A0, A1, sc.redline / sc.max);
    const a = lerpA(A0, A1, v.rpmFrac);
    if (v.limiter) {
      ring(ctx, c, A0, a, RED);
      if (blink(v.t, 6)) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.r, 0, TAU);
        ctx.lineWidth = 3;
        ctx.strokeStyle = RED;
        ctx.stroke();
      }
    } else {
      ring(ctx, c, A0, Math.min(a, redA), WHITE);
      if (a > redA) ring(ctx, c, redA, a, RED);
    }
    text(ctx, v.gear, c.cx, c.cy - c.r * 0.43, thin(c.r * 0.09, 600), v.gear === 'R' ? RED : WHITE);
    text(ctx, String(Math.round(v.speed)), c.cx, c.cy - c.r * 0.04, thin(c.r * 0.46, 300), WHITE);
    text(ctx, String(Math.round(v.rpmRaw)), c.cx, c.cy + c.r * 0.76, thin(c.r * 0.075, 500), WHITE);

    // Power meter: white for power, blue below zero. Battery shows fuel.
    const zeroA = lerpA(A0, A1, -P_MIN / (1 - P_MIN));
    const pf = v.sweep > 0 ? v.sweep : clamp(v.powerFrac, P_MIN, 1);
    ring(ctx, l, zeroA, lerpA(A0, A1, (pf - P_MIN) / (1 - P_MIN)), pf >= 0 ? WHITE : REGEN);
    text(ctx, String(Math.round(v.power)), l.cx, l.cy - l.r * 0.18, thin(l.r * 0.3, 300), WHITE);
    text(ctx, v.powerUnit, l.cx, l.cy + l.r * 0.05, thin(l.r * 0.07, 500), DIM);
    const b = L.battery;
    const fw = (b.w - 8) * v.fuelFrac;
    if (fw > 1) {
      roundRect(ctx, b.x + 4, b.y + 4, fw, b.h - 8, (b.h - 8) * 0.25);
      ctx.fillStyle = v.sweep > 0 ? ACID : !v.live ? DIM : v.fuel < 0.1 ? RED : v.fuel < 0.2 ? AMBER : ACID;
      ctx.fill();
    }
    text(ctx, `${Math.round(v.fuel * 100)}%`, l.cx, b.y + b.h + l.r * 0.12, thin(l.r * 0.075, 500), WHITE);
    text(ctx, `${v.boost.toFixed(v.metric ? 2 : 1)} ${v.boostUnit}`, l.cx, l.cy + l.r * 0.76, thin(l.r * 0.085, 500), WHITE);

    // G-meter
    const gTot = Math.hypot(v.gLat, v.gLon);
    ring(ctx, r, A0, lerpA(A0, A1, Math.max(gTot / 2, v.sweep)), ACID);
    const k = (r.r * 0.62) / G_MAX;
    const g = gFelt(v.gLat, v.gLon, G_MAX);
    ctx.beginPath();
    ctx.arc(r.cx + g[0] * k, r.cy + g[1] * k, r.r * 0.045, 0, TAU);
    ctx.fillStyle = WHITE;
    ctx.fill();
    text(ctx, `${gTot.toFixed(2)} g`, r.cx, r.cy + r.r * 0.76, thin(r.r * 0.085, 500), WHITE);

    // Info row under the pods
    text(ctx, v.classLine, l.cx, L.infoY, thin(24, 500), DIM);
    const lap = fmtCur(Math.round(v.curLap * 1000) / 1000);
    text(ctx, v.lap ? `LAP ${v.lap}   ${lap}` : lap, c.cx, L.infoY, thin(30, 500), WHITE);
    text(ctx, `BEST ${fmtBest(v.bestLap)}${v.position ? `   P${v.position}` : ''}`, r.cx, L.infoY, thin(24, 500), DIM);
  },
};

// Porsche GT3 (992 GT3 / GT3 RS inspired): a physical centre tachometer with
// yellow ticks and a yellow needle, digital speed and gear in its lower face,
// and round dials on the side screens: speedometer and boost on the left,
// G-meter and laps on the right.

import { FONTS, font, roundRect, sector, tickPath, text, blink, glowSprite, drawSprite, clamp, DEG, TAU, memo, needlePath, gFelt } from './common.js';
import { lapTime } from '../units.js';

const YELLOW = '#f5c400';
const NEEDLE = '#ffd21f';
const RED = '#e1001a';
const WHITE = '#f2f2f2';
const DIM = '#80868c';
const A0 = 150 * DEG; // tach: zero at eight o'clock...
const A1 = 390 * DEG; // ...top of the scale at four o'clock
const D0 = 135 * DEG; // side dials
const D1 = 405 * DEG;
const G_MAX = 1.5;

const fmtCur = memo(lapTime);
const fmtLast = memo(lapTime);
const fmtBest = memo(lapTime);

const lerpA = (a0, a1, f) => a0 + (a1 - a0) * clamp(f, 0, 1);
const tachAngle = (f) => lerpA(A0, A1, f);
const onStep = (x, step) => Math.abs(x / step - Math.round(x / step)) < 1e-6;

const speedScale = (v) => (v.metric
  ? { min: 0, max: v.speedMax, minor: 10, major: 20, label: 60 }
  : { min: 0, max: v.speedMax, minor: 5, major: 20, label: 40 });

const boostScale = (v) => (v.metric
  ? { min: v.boostMin, max: v.boostMax, minor: 0.1, major: 0.5, label: 1 }
  : { min: v.boostMin, max: v.boostMax, minor: 1, major: 5, label: 10 });

// Round virtual dial: dark face, thin rim, yellow minor ticks, white major
// ticks and numerals.
function dialFace(ctx, d, s) {
  const { cx, cy, r } = d;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = '#0a0d10';
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.02);
  ctx.strokeStyle = '#272c31';
  ctx.stroke();

  const span = s.max - s.min;
  const n = Math.round(span / s.minor);
  const at = (x) => lerpA(D0, D1, (x - s.min) / span);
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = s.min + i * s.minor;
    if (!onStep(x, s.major)) tickPath(ctx, cx, cy, r * 0.86, r * 0.93, at(x));
  }
  ctx.lineWidth = Math.max(1.5, r * 0.012);
  ctx.strokeStyle = YELLOW;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = s.min + i * s.minor;
    if (onStep(x, s.major)) tickPath(ctx, cx, cy, r * 0.79, r * 0.93, at(x));
  }
  ctx.lineWidth = Math.max(2.5, r * 0.026);
  ctx.strokeStyle = WHITE;
  ctx.stroke();

  const f = font(Math.round(r * 0.15), FONTS.din, 700);
  for (let i = 0; i <= n; i++) {
    const x = s.min + i * s.minor;
    if (!onStep(x, s.label)) continue;
    const a = at(x);
    text(ctx, String(Math.round(x * 10) / 10), cx + Math.cos(a) * r * 0.63, cy + Math.sin(a) * r * 0.63, f, WHITE);
  }
}

function dialNeedle(ctx, d, frac) {
  const a = lerpA(D0, D1, frac);
  const r = d.r;
  needlePath(ctx, d.cx + r * 0.015, d.cy + r * 0.025, a, r * 0.14, r * 0.9, r * 0.02, r * 0.035, r * 0.01);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  needlePath(ctx, d.cx, d.cy, a, r * 0.14, r * 0.9, r * 0.016, r * 0.03, r * 0.008);
  ctx.fillStyle = NEEDLE;
  ctx.fill();
}

function silverCap(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#c9ccd0');
  g.addColorStop(0.8, '#6d7176');
  g.addColorStop(1, '#2a2c2f');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.strokeStyle = '#1a1b1d';
  ctx.stroke();
}

export default {
  id: 'porsche',
  name: 'Porsche GT3',
  bg: '#040506',

  layout(W, H) {
    const R = Math.min(380, 0.25 * W, 0.46 * H);
    const cx = W / 2;
    const cy = 440;
    const m = 16;
    const colW = cx - R - 24 - m;
    const lx = m + colW / 2;
    const rx = W - m - colW / 2;
    const rBig = clamp(colW * 0.47, 100, 175);
    const rSmall = rBig * 0.72;
    const yBig = 255;
    const ySmall = 620;
    return {
      R, cx, cy, colW,
      screens: [{ x: m, y: 40, w: colW, h: 820 }, { x: W - m - colW, y: 40, w: colW, h: 820 }],
      speedo: { cx: lx, cy: yBig, r: rBig },
      boost: { cx: lx, cy: ySmall, r: rSmall },
      gm: { cx: rx, cy: yBig, r: rBig },
      lap: { cx: rx, cy: ySmall, w: colW - 48, s: clamp(colW / 282, 1, 1.45) },
      bottomY: 812,
    };
  },

  drawStatic(ctx, L, v) {
    const { R, cx, cy, view } = L;
    const sc = v.scale;

    ctx.fillStyle = '#040506';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

    // Side screens
    for (const p of L.screens) {
      roundRect(ctx, p.x, p.y, p.w, p.h, 28);
      ctx.fillStyle = '#080b0e';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.stroke();
    }

    // Tach housing and its shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 40 * L.px;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = '#0b0d0f';
    ctx.fill();
    ctx.restore();
    const rim = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    rim.addColorStop(0, '#50555b');
    rim.addColorStop(0.5, '#1c1f22');
    rim.addColorStop(1, '#383c41');
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.978, 0, TAU);
    ctx.lineWidth = R * 0.044;
    ctx.strokeStyle = rim;
    ctx.stroke();

    // Numeral band and inner face
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.8, 0, TAU);
    const band = ctx.createLinearGradient(cx, cy - R * 0.8, cx, cy + R * 0.8);
    band.addColorStop(0, '#34383c');
    band.addColorStop(1, '#222528');
    ctx.fillStyle = band;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.6, 0, TAU);
    ctx.fillStyle = '#090b0d';
    ctx.fill();
    ctx.beginPath();
    for (let k = 0.1; k < 0.6; k += 0.035) {
      ctx.moveTo(cx + R * k, cy);
      ctx.arc(cx, cy, R * k, 0, TAU);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + R * 0.8, cy);
    ctx.arc(cx, cy, R * 0.8, 0, TAU);
    ctx.moveTo(cx + R * 0.6, cy);
    ctx.arc(cx, cy, R * 0.6, 0, TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.stroke();

    // Redline: solid bar at the edge and red hatching across the tick band
    const ra = tachAngle(sc.redline / sc.max);
    sector(ctx, cx, cy, R * 0.935, R * 0.956, ra, A1);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.save();
    sector(ctx, cx, cy, R * 0.81, R * 0.9, ra, A1);
    ctx.clip();
    ctx.beginPath();
    for (let a = ra - 6 * DEG; a < A1 + 2 * DEG; a += 1.6 * DEG) {
      ctx.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
      ctx.lineTo(cx + Math.cos(a + 3 * DEG) * R * 0.91, cy + Math.sin(a + 3 * DEG) * R * 0.91);
    }
    ctx.lineWidth = R * 0.006;
    ctx.strokeStyle = 'rgba(225,0,26,0.9)';
    ctx.stroke();
    ctx.restore();

    // Ticks: fine yellow every tenth of a major step, white blocks at majors
    const fine = sc.major / 10;
    const n = Math.round(sc.max / fine);
    for (const red of [false, true]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        if (i % 10 === 0) continue;
        const rpm = i * fine;
        if ((rpm >= sc.redline) !== red) continue;
        tickPath(ctx, cx, cy, R * (i % 5 === 0 ? 0.87 : 0.905), R * 0.95, tachAngle(rpm / sc.max));
      }
      ctx.lineWidth = R * 0.006;
      ctx.strokeStyle = red ? RED : YELLOW;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let rpm = 0; rpm <= sc.max + 1; rpm += sc.major) tickPath(ctx, cx, cy, R * 0.83, R * 0.95, tachAngle(rpm / sc.max));
    ctx.lineWidth = R * 0.022;
    ctx.strokeStyle = WHITE;
    ctx.stroke();

    const numFont = font(Math.round(R * 0.13), FONTS.din, 700);
    for (let rpm = 0; rpm <= sc.max + 1; rpm += sc.major) {
      const a = tachAngle(rpm / sc.max);
      text(ctx, String(rpm / 1000), cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7, numFont, WHITE);
    }
    text(ctx, '1/min × 1000', cx, cy + R * 0.9, font(Math.round(R * 0.042), FONTS.avenir, 600), DIM);
    text(ctx, 'GT3', cx, cy - R * 0.3, font(Math.round(R * 0.12), FONTS.avenir, 800, 'italic'), '#5b6167');

    // Digital speed window in the lower face
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.6, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#040506';
    ctx.fillRect(cx - R * 0.6, cy + R * 0.1, R * 1.2, R * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(cx - R * 0.6, cy + R * 0.1, R * 1.2, 1.5);
    ctx.restore();
    text(ctx, v.speedUnit, cx - R * 0.04, cy + R * 0.47, font(Math.round(R * 0.06), FONTS.avenir, 600), DIM);

    // Left screen: speedometer and boost
    dialFace(ctx, L.speedo, speedScale(v));
    text(ctx, v.speedUnit, L.speedo.cx, L.speedo.cy + L.speedo.r * 0.36, font(Math.round(L.speedo.r * 0.11), FONTS.avenir, 600), DIM);
    text(ctx, 'SPEED', L.speedo.cx, L.speedo.cy - L.speedo.r - 20, font(18, FONTS.avenir, 700), DIM);
    const b = L.boost;
    dialFace(ctx, b, boostScale(v));
    text(ctx, 'BOOST', b.cx, b.cy - b.r - 20, font(18, FONTS.avenir, 700), DIM);
    text(ctx, v.boostUnit, b.cx, b.cy + b.r * 0.62, font(Math.round(b.r * 0.12), FONTS.avenir, 600), DIM);

    const s0 = L.screens[0];
    text(ctx, 'FUEL', s0.x + 24, L.bottomY - 20, font(18, FONTS.avenir, 600), DIM, 'left');
    roundRect(ctx, s0.x + 24, L.bottomY, s0.w - 48, 8, 4);
    ctx.fillStyle = '#1b1f23';
    ctx.fill();

    // Right screen: G-meter and laps
    const gm = L.gm;
    const k = (gm.r * 0.82) / G_MAX;
    ctx.beginPath();
    ctx.arc(gm.cx, gm.cy, gm.r, 0, TAU);
    ctx.fillStyle = '#0a0d10';
    ctx.fill();
    ctx.lineWidth = Math.max(2, gm.r * 0.02);
    ctx.strokeStyle = '#272c31';
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 48; i++) tickPath(ctx, gm.cx, gm.cy, gm.r * (i % 4 ? 0.9 : 0.86), gm.r * 0.95, (i / 48) * TAU);
    ctx.lineWidth = Math.max(1.5, gm.r * 0.012);
    ctx.strokeStyle = YELLOW;
    ctx.stroke();
    ctx.beginPath();
    for (const g of [0.5, 1, 1.5]) {
      ctx.moveTo(gm.cx + g * k, gm.cy);
      ctx.arc(gm.cx, gm.cy, g * k, 0, TAU);
    }
    ctx.moveTo(gm.cx - G_MAX * k, gm.cy);
    ctx.lineTo(gm.cx + G_MAX * k, gm.cy);
    ctx.moveTo(gm.cx, gm.cy - G_MAX * k);
    ctx.lineTo(gm.cx, gm.cy + G_MAX * k);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2e3338';
    ctx.stroke();
    const small = font(Math.round(gm.r * 0.09), FONTS.avenir, 600);
    text(ctx, '1g', gm.cx + k * 0.72, gm.cy - k * 0.72, small, DIM);
    text(ctx, 'G-FORCE', gm.cx, gm.cy - gm.r - 20, font(18, FONTS.avenir, 700), DIM);

    const lp = L.lap;
    const x0 = lp.cx - lp.w / 2;
    const lf = font(Math.round(18 * lp.s), FONTS.avenir, 600);
    text(ctx, 'LAP', x0, lp.cy - 72 * lp.s, lf, DIM, 'left');
    text(ctx, 'LAST', x0, lp.cy + 48 * lp.s, lf, DIM, 'left');
    text(ctx, 'BEST', x0, lp.cy + 90 * lp.s, lf, DIM, 'left');
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x0, lp.cy + 22 * lp.s, lp.w, 1.5);
  },

  drawDynamic(ctx, L, v) {
    const { R, cx, cy } = L;
    const t = v.t;

    // Limiter: the housing ring flashes red
    if (v.live && v.rpmRatio >= 0.965 && blink(t, 10)) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.978, 0, TAU);
      ctx.lineWidth = R * 0.044;
      ctx.strokeStyle = 'rgba(255,24,24,0.95)';
      ctx.stroke();
    }

    // Speed and gear in the lower face, under the needle
    text(ctx, String(Math.round(v.speed)), cx - R * 0.04, cy + R * 0.27, font(Math.round(R * 0.25), FONTS.din, 700), WHITE);
    text(ctx, v.gear, cx + R * 0.36, cy + R * 0.27, font(Math.round(R * 0.15), FONTS.din, 700), v.gear === 'R' ? '#ff4d3a' : YELLOW);

    // Side dials
    dialNeedle(ctx, L.speedo, v.speedFrac);
    text(ctx, `${v.distance.toFixed(1)} ${v.distanceUnit}`, L.speedo.cx, L.speedo.cy + L.speedo.r * 0.78, font(Math.round(Math.max(15, L.speedo.r * 0.1)), FONTS.avenir, 600), DIM);
    const b = L.boost;
    text(ctx, v.boost.toFixed(v.metric ? 2 : 1), b.cx, b.cy + b.r * 0.42, font(Math.round(b.r * 0.2), FONTS.din, 700), WHITE);
    dialNeedle(ctx, b, v.boostFrac);

    const gm = L.gm;
    const k = (gm.r * 0.82) / G_MAX;
    const g = gFelt(v.gLat, v.gLon, 1.6);
    const dot = Math.round(gm.r * 0.07);
    drawSprite(ctx, glowSprite(YELLOW, dot), gm.cx + g[0] * k, gm.cy + g[1] * k, dot);
    text(ctx, `${Math.hypot(v.gLat, v.gLon).toFixed(2)} g`, gm.cx, gm.cy + gm.r + 26, font(20, FONTS.avenir, 600), WHITE);

    // Laps
    const lp = L.lap;
    const x0 = lp.cx - lp.w / 2, x1 = lp.cx + lp.w / 2;
    const lf = font(Math.round(18 * lp.s), FONTS.avenir, 700);
    text(ctx, v.lap ? String(v.lap) : '—', x0 + 46 * lp.s, lp.cy - 72 * lp.s, lf, WHITE, 'left');
    if (v.position) text(ctx, `P${v.position}`, x1, lp.cy - 72 * lp.s, lf, WHITE, 'right');
    text(ctx, fmtCur(Math.round(v.curLap * 1000) / 1000), lp.cx, lp.cy - 22 * lp.s, font(Math.round(lp.w * 0.2), FONTS.din, 700), WHITE);
    const vf = font(Math.round(22 * lp.s), FONTS.din, 700);
    text(ctx, fmtLast(v.lastLap), x1, lp.cy + 48 * lp.s, vf, WHITE, 'right');
    text(ctx, fmtBest(v.bestLap), x1, lp.cy + 90 * lp.s, vf, YELLOW, 'right');

    // Fuel and car line along the bottom
    const s0 = L.screens[0], s1 = L.screens[1];
    const low = v.live && v.fuel < 0.15;
    if (v.fuelFrac > 0.005) {
      roundRect(ctx, s0.x + 24, L.bottomY, (s0.w - 48) * v.fuelFrac, 8, 4);
      ctx.fillStyle = low ? '#ffb000' : WHITE;
      ctx.fill();
    }
    text(ctx, `${Math.round(v.fuel * 100)}%`, s0.x + s0.w - 24, L.bottomY - 20, font(18, FONTS.avenir, 600), low ? '#ffb000' : WHITE, 'right');
    text(ctx, v.classLine, s1.x + s1.w / 2, L.bottomY - 2, font(20, FONTS.avenir, 600), DIM);

    // Tach needle with a drop shadow
    const a = tachAngle(v.rpmFrac);
    needlePath(ctx, cx + R * 0.012, cy + R * 0.022, a, R * 0.16, R * 0.93, R * 0.016, R * 0.026, R * 0.008);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    needlePath(ctx, cx, cy, a, R * 0.16, R * 0.93, R * 0.013, R * 0.022, R * 0.006);
    ctx.fillStyle = NEEDLE;
    ctx.fill();
  },

  drawGlass(ctx, L) {
    const { R, cx, cy } = L;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.956, 0, TAU);
    ctx.clip();
    const g = ctx.createLinearGradient(0, cy - R, 0, cy);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy - R * 0.55, R * 0.95, R * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    silverCap(ctx, cx, cy, R * 0.065);
    silverCap(ctx, L.speedo.cx, L.speedo.cy, L.speedo.r * 0.085);
    silverCap(ctx, L.boost.cx, L.boost.cy, L.boost.r * 0.1);
  },
};

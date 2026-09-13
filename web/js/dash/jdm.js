// JDM Analog (90s Supra / GT-R / RX-7 inspired): chrome-bezel tach and
// speedo with orange pointers, small boost and fuel gauges between them.

import { FONTS, font, roundRect, sector, tickPath, text, blink, clamp, DEG, memo } from './common.js';
import { lapTime } from '../units.js';

const WARM = '#f3e6cf';
const RED = '#ff3b2f';
const NEEDLE = '#ff6a00';
const AMBER = '#ffb347';
const BIG_A0 = 135 * DEG;
const BIG_A1 = 405 * DEG;
const BOOST_A0 = 150 * DEG;
const BOOST_A1 = 390 * DEG;
const FUEL_A0 = 210 * DEG;
const FUEL_A1 = 330 * DEG;

const fmtCur = memo(lapTime);
const fmtBest = memo(lapTime);

const lerpAngle = (a0, a1, f) => a0 + (a1 - a0) * clamp(f, 0, 1);

function chromeBezel(ctx, cx, cy, r, inner) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  [['#fbfbfb', 0], ['#9a9a9a', 0.22], ['#f2f2f2', 0.45], ['#555', 0.63], ['#dadada', 0.8], ['#6a6a6a', 1]].forEach(([c, o]) => g.addColorStop(o, c));
  ctx.beginPath();
  ctx.arc(cx, cy, (r + inner) / 2, 0, Math.PI * 2);
  ctx.lineWidth = r - inner;
  ctx.strokeStyle = g;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  const face = ctx.createRadialGradient(cx, cy, 0, cx, cy, inner);
  face.addColorStop(0, '#0b0a09');
  face.addColorStop(0.5, '#080707');
  face.addColorStop(0.8, 'rgba(60,30,8,1)');
  face.addColorStop(0.83, '#090807');
  face.addColorStop(1, '#030303');
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

function lcd(ctx, x, y, w, h, ghost, size) {
  roundRect(ctx, x, y, w, h, h * 0.12);
  ctx.fillStyle = '#1a1105';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3b2a0c';
  ctx.stroke();
  text(ctx, ghost, x + w - h * 0.25, y + h / 2 + 2, font(size, FONTS.mono, 700), 'rgba(255,179,71,0.07)', 'right');
}

function pointer(ctx, cx, cy, a, r, px) {
  const c = Math.cos(a), s = Math.sin(a);
  const tip = r * 0.86, tail = r * 0.2;
  const w0 = r * 0.03, w1 = r * 0.006;
  ctx.beginPath();
  ctx.moveTo(cx - c * tail - s * w0, cy - s * tail + c * w0);
  ctx.lineTo(cx + c * tip - s * w1, cy + s * tip + c * w1);
  ctx.lineTo(cx + c * tip + s * w1, cy + s * tip - c * w1);
  ctx.lineTo(cx - c * tail + s * w0, cy - s * tail - c * w0);
  ctx.closePath();
  ctx.shadowColor = 'rgba(255,106,0,0.75)';
  ctx.shadowBlur = 10 * px;
  ctx.fillStyle = NEEDLE;
  ctx.fill();
  // Counterweight disc, filled separately so the winding rule can't hollow it out.
  ctx.beginPath();
  ctx.arc(cx - c * r * 0.13, cy - s * r * 0.13, r * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function cap(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  g.addColorStop(0, '#6b6b6b');
  g.addColorStop(0.45, '#262626');
  g.addColorStop(1, '#070707');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function scaleTicks(ctx, g, a0, a1, max, steps, colorAt) {
  // steps: [[every, r0, r1, width]], drawn finest first so coarse ticks sit on top
  for (const [every, r0, r1, width] of steps) {
    for (const red of [false, true]) {
      ctx.beginPath();
      for (let x = 0; x <= max + 1e-6; x += every) {
        if (colorAt(x) !== red) continue;
        tickPath(ctx, g.cx, g.cy, g.r * r0, g.r * r1, lerpAngle(a0, a1, x / max));
      }
      ctx.lineWidth = g.r * width;
      ctx.strokeStyle = red ? RED : WARM;
      ctx.stroke();
    }
  }
}

export default {
  id: 'jdm',
  name: 'JDM Analog',
  bg: '#050505',

  layout(W, H) {
    const R = Math.min(clamp((W - 100) / 4.4, 250, 340), 0.38 * H);
    const cy = 455;
    const mid = W / 2;
    const r = 0.33 * R;
    const tach = { cx: mid - 1.075 * R, cy, r: R };
    const speedo = { cx: mid + 1.075 * R, cy, r: R };
    const hood = { x: tach.cx - R - 46, y: cy - R - 56, w: 2.15 * R + 2 * R + 92, h: 2 * R + 112 };
    return {
      R, tach, speedo, hood,
      boost: { cx: mid, cy: cy - 0.85 * R, r },
      fuel: { cx: mid, cy: cy + 0.85 * R, r },
      stripY: Math.min(H - 30, hood.y + hood.h + 36),
    };
  },

  drawStatic(ctx, L, v) {
    const { R, tach, speedo, boost, fuel, hood, view } = L;
    const sc = v.scale;

    ctx.fillStyle = '#050505';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

    // Matte cluster hood
    roundRect(ctx, hood.x, hood.y, hood.w, hood.h, hood.h * 0.46);
    const hg = ctx.createLinearGradient(0, hood.y, 0, hood.y + hood.h);
    hg.addColorStop(0, '#1b1b1e');
    hg.addColorStop(0.5, '#111113');
    hg.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();

    const inner = 0.94;

    // Tachometer
    chromeBezel(ctx, tach.cx, tach.cy, R, R * inner);
    const redFrac = sc.redline / sc.max;
    sector(ctx, tach.cx, tach.cy, R * 0.83, R * 0.885, lerpAngle(BIG_A0, BIG_A1, redFrac), BIG_A1);
    ctx.fillStyle = '#c81e1e';
    ctx.fill();
    scaleTicks(ctx, tach, BIG_A0, BIG_A1, sc.max, [
      [sc.minor / 2, 0.85, 0.9, 0.006],
      [sc.minor, 0.82, 0.9, 0.01],
      [sc.major, 0.76, 0.9, 0.02],
    ], (x) => x >= sc.redline);
    const tachFont = font(Math.round(R * 0.15), FONTS.din, 700);
    for (let x = 0; x <= sc.max + 1; x += sc.major) {
      const a = lerpAngle(BIG_A0, BIG_A1, x / sc.max);
      text(ctx, String(x / 1000), tach.cx + Math.cos(a) * R * 0.63, tach.cy + Math.sin(a) * R * 0.63, tachFont, x >= sc.redline ? RED : WARM);
    }
    text(ctx, '×1000r/min', tach.cx, tach.cy - R * 0.3, font(Math.round(R * 0.062), FONTS.avenir, 600, 'italic'), '#cdbf9f');
    lcd(ctx, tach.cx - R * 0.15, tach.cy + R * 0.34, R * 0.3, R * 0.22, '8', Math.round(R * 0.17));
    roundRect(ctx, tach.cx - R * 0.15, tach.cy + R * 0.64, R * 0.3, R * 0.1, R * 0.02);
    ctx.fillStyle = '#240606';
    ctx.fill();
    text(ctx, 'SHIFT', tach.cx, tach.cy + R * 0.69 + 1, font(Math.round(R * 0.06), FONTS.avenir, 700), '#4a1414');

    // Speedometer: 0–200 mph (labels every 20) or 0–360 km/h (every 40)
    chromeBezel(ctx, speedo.cx, speedo.cy, R, R * inner);
    const sMax = v.speedMax;
    const label = v.metric ? 40 : 20;
    scaleTicks(ctx, speedo, BIG_A0, BIG_A1, sMax, [
      [label / 4, 0.85, 0.9, 0.006],
      [label / 2, 0.82, 0.9, 0.01],
      [label, 0.76, 0.9, 0.02],
    ], () => false);
    const spdFont = font(Math.round(R * 0.12), FONTS.din, 700);
    for (let x = 0; x <= sMax; x += label) {
      const a = lerpAngle(BIG_A0, BIG_A1, x / sMax);
      text(ctx, String(x), speedo.cx + Math.cos(a) * R * 0.64, speedo.cy + Math.sin(a) * R * 0.64, spdFont, WARM);
    }
    text(ctx, v.metric ? 'km/h' : 'MPH', speedo.cx, speedo.cy - R * 0.3, font(Math.round(R * 0.07), FONTS.avenir, 600, 'italic'), '#cdbf9f');
    lcd(ctx, speedo.cx - R * 0.27, speedo.cy + R * 0.36, R * 0.54, R * 0.2, '88888.8', Math.round(R * 0.12));
    text(ctx, `ODO ${v.distanceUnit}`, speedo.cx, speedo.cy + R * 0.66, font(Math.round(R * 0.05), FONTS.avenir, 600), '#8c8067');

    // Boost
    chromeBezel(ctx, boost.cx, boost.cy, boost.r, boost.r * 0.88);
    const bSpan = v.boostMax - v.boostMin;
    const bTick = v.metric ? 0.25 : 5;
    const bLabel = v.metric ? 1 : 10;
    ctx.beginPath();
    for (let x = v.boostMin; x <= v.boostMax + 1e-6; x += bTick) {
      const major = Math.abs(x % bLabel) < 1e-6;
      tickPath(ctx, boost.cx, boost.cy, boost.r * (major ? 0.62 : 0.7), boost.r * 0.8, lerpAngle(BOOST_A0, BOOST_A1, (x - v.boostMin) / bSpan));
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = WARM;
    ctx.stroke();
    const smallFont = font(Math.round(boost.r * 0.2), FONTS.din, 700);
    for (let x = 0; x <= v.boostMax + 1e-6; x += bLabel) {
      const a = lerpAngle(BOOST_A0, BOOST_A1, (x - v.boostMin) / bSpan);
      text(ctx, String(x), boost.cx + Math.cos(a) * boost.r * 0.45, boost.cy + Math.sin(a) * boost.r * 0.45, smallFont, WARM);
    }
    text(ctx, 'BOOST', boost.cx, boost.cy + boost.r * 0.52, font(Math.round(boost.r * 0.15), FONTS.avenir, 700), '#cdbf9f');
    text(ctx, v.boostUnit, boost.cx, boost.cy + boost.r * 0.7, font(Math.round(boost.r * 0.13), FONTS.avenir, 600), '#8c8067');

    // Fuel
    chromeBezel(ctx, fuel.cx, fuel.cy, fuel.r, fuel.r * 0.88);
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) tickPath(ctx, fuel.cx, fuel.cy, fuel.r * (i % 2 ? 0.7 : 0.6), fuel.r * 0.8, lerpAngle(FUEL_A0, FUEL_A1, i / 4));
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = WARM;
    ctx.stroke();
    const fa = (f) => lerpAngle(FUEL_A0, FUEL_A1, f);
    text(ctx, 'E', fuel.cx + Math.cos(fa(0)) * fuel.r * 0.46, fuel.cy + Math.sin(fa(0)) * fuel.r * 0.46, smallFont, RED);
    text(ctx, 'F', fuel.cx + Math.cos(fa(1)) * fuel.r * 0.46, fuel.cy + Math.sin(fa(1)) * fuel.r * 0.46, smallFont, WARM);
    text(ctx, 'FUEL', fuel.cx, fuel.cy + fuel.r * 0.42, font(Math.round(fuel.r * 0.15), FONTS.avenir, 700), '#cdbf9f');
  },

  drawDynamic(ctx, L, v) {
    const { R, tach, speedo, boost, fuel } = L;
    const t = v.t;

    // Gear LCD and SHIFT lamp
    text(ctx, v.gear, tach.cx + R * 0.15 - R * 0.22 * 0.25, tach.cy + R * 0.45 + 2, font(Math.round(R * 0.17), FONTS.mono, 700), AMBER, 'right');
    const shiftOn = v.live && (v.limiter ? blink(t, 8) : v.rpmRatio >= 0.92);
    if (shiftOn) {
      roundRect(ctx, tach.cx - R * 0.15, tach.cy + R * 0.64, R * 0.3, R * 0.1, R * 0.02);
      ctx.shadowColor = 'rgba(255,40,20,0.9)';
      ctx.shadowBlur = 18 * L.px;
      ctx.fillStyle = '#ff2a14';
      ctx.fill();
      ctx.shadowBlur = 0;
      text(ctx, 'SHIFT', tach.cx, tach.cy + R * 0.69 + 1, font(Math.round(R * 0.06), FONTS.avenir, 700), '#fff3e6');
    }

    // ODO
    text(ctx, v.distance.toFixed(1), speedo.cx + R * 0.27 - R * 0.05, speedo.cy + R * 0.46 + 2, font(Math.round(R * 0.12), FONTS.mono, 700), AMBER, 'right');

    // Needles
    pointer(ctx, tach.cx, tach.cy, lerpAngle(BIG_A0, BIG_A1, v.rpmFrac), R, L.px);
    pointer(ctx, speedo.cx, speedo.cy, lerpAngle(BIG_A0, BIG_A1, v.speedFrac), R, L.px);
    pointer(ctx, boost.cx, boost.cy, lerpAngle(BOOST_A0, BOOST_A1, v.boostFrac), boost.r * 0.95, L.px);
    pointer(ctx, fuel.cx, fuel.cy, lerpAngle(FUEL_A0, FUEL_A1, v.fuelFrac), fuel.r * 0.95, L.px);

    // Info strip under the hood
    const y = L.stripY;
    const f = font(24, FONTS.avenir, 600);
    text(ctx, v.classLine, L.hood.x + 40, y, f, '#8c8067', 'left');
    const laps = `${v.lap ? `LAP ${v.lap}   ` : ''}${fmtCur(Math.round(v.curLap * 10) / 10)}   BEST ${fmtBest(v.bestLap)}`;
    text(ctx, laps, L.hood.x + L.hood.w - 40, y, f, '#cdbf9f', 'right');
  },

  drawGlass(ctx, L) {
    const { R, tach, speedo, boost, fuel } = L;
    for (const g of [tach, speedo, boost, fuel]) {
      const inner = g.r * (g === tach || g === speedo ? 0.94 : 0.88);
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, inner, 0, Math.PI * 2);
      ctx.clip();
      const grad = ctx.createLinearGradient(g.cx - inner, g.cy - inner, g.cx, g.cy);
      grad.addColorStop(0, 'rgba(255,255,255,0.10)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(g.cx - inner, g.cy - inner);
      ctx.lineTo(g.cx + inner * 0.55, g.cy - inner);
      ctx.lineTo(g.cx - inner, g.cy + inner * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    cap(ctx, tach.cx, tach.cy, R * 0.075);
    cap(ctx, speedo.cx, speedo.cy, R * 0.075);
    cap(ctx, boost.cx, boost.cy, boost.r * 0.13);
    cap(ctx, fuel.cx, fuel.cy, fuel.r * 0.13);
  },
};

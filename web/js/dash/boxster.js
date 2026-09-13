// Porsche Boxster (987, 2009) inspired: three overlapping round gauges with
// white faces, chrome rings and red-orange needles. Speedometer on the left,
// tachometer in front in the centre with a seven-segment gear and speed
// display, boost and fuel on the right.

import { FONTS, font, roundRect, sector, tickPath, text, clamp, DEG, TAU, memo, needlePath, sevenSeg, glowSprite, drawSprite } from './common.js';
import { lapTime } from '../units.js';

const INK = '#161616';
const INK_DIM = '#5f5e5a';
const RED_INK = '#c4122f';
const NEEDLE = '#ff3d17';
const LCD_BG = '#0c0a08';
const LCD_ON = '#ff7a1a';
const LCD_OFF = 'rgba(255,122,26,0.09)';
const T0 = 150 * DEG; // tach: zero at eight o'clock, top of the scale at four
const T1 = 390 * DEG;
const S0 = 135 * DEG; // speedo: ends at half past one, before the tach covers it
const S1 = 315 * DEG;
const B0 = 215 * DEG; // boost: across the top of the right gauge
const B1 = 325 * DEG;
const F0 = 40 * DEG; // fuel: E at lower right, F at upper right
const F1 = -35 * DEG;

function lcdLap(sec) {
  if (!(sec > 0)) return '-:--.-';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

const fmtSpeed = memo(String);
const fmtOdo = memo((x) => x.toFixed(1));
const fmtLap = memo(lcdLap);
const fmtBest = memo(lapTime);

const lerpA = (a0, a1, f) => a0 + (a1 - a0) * clamp(f, 0, 1);
const onStep = (x, step) => Math.abs(x / step - Math.round(x / step)) < 1e-6;

function shadowDisc(ctx, p, px, blur) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = blur * px;
  ctx.shadowOffsetY = blur * 0.25 * px;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, p.r, 0, TAU);
  ctx.fillStyle = '#0b0b0b';
  ctx.fill();
  ctx.restore();
}

// Chrome ring and a white face with a shaded rim.
function gaugeBody(ctx, p) {
  const { cx, cy, r } = p;
  const chrome = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  [['#ffffff', 0], ['#8d8f93', 0.25], ['#f4f5f6', 0.5], ['#6b6d71', 0.72], ['#d9dadc', 0.88], ['#7a7c80', 1]].forEach(([c, o]) => chrome.addColorStop(o, c));
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.965, 0, TAU);
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = chrome;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#050505';
  ctx.stroke();

  const face = ctx.createRadialGradient(cx - r * 0.18, cy - r * 0.25, r * 0.05, cx, cy, r * 0.93);
  face.addColorStop(0, '#fefefc');
  face.addColorStop(0.72, '#efeee9');
  face.addColorStop(0.93, '#d7d6cf');
  face.addColorStop(1, '#b3b2ab');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.93, 0, TAU);
  ctx.fillStyle = face;
  ctx.fill();
}

// steps: [[every, r0, r1, width]], finest first so coarse ticks sit on top.
function scale(ctx, p, a0, a1, max, steps, isRed) {
  for (const [every, r0, r1, width] of steps) {
    const n = Math.round(max / every);
    for (const red of [false, true]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const x = i * every;
        if (isRed(x) === red) tickPath(ctx, p.cx, p.cy, p.r * r0, p.r * r1, lerpA(a0, a1, x / max));
      }
      ctx.lineWidth = p.r * width;
      ctx.strokeStyle = red ? RED_INK : INK;
      ctx.stroke();
    }
  }
}

function lcdBox(ctx, b) {
  roundRect(ctx, b.x, b.y, b.w, b.h, b.h * 0.18);
  ctx.fillStyle = LCD_BG;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#9a9993';
  ctx.stroke();
}

// Clips to a side gauge, minus the part the centre tach covers.
function clipBehindTach(ctx, side, c, view) {
  ctx.beginPath();
  ctx.arc(side.cx, side.cy, side.r, 0, TAU);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  ctx.moveTo(c.cx + c.r, c.cy);
  ctx.arc(c.cx, c.cy, c.r, 0, TAU);
  ctx.clip('evenodd');
}

function pointer(ctx, cx, cy, a, r, len, tail, hub) {
  needlePath(ctx, cx + r * 0.012, cy + r * 0.024, a, r * tail, r * len, r * 0.012, r * hub * 1.1, r * 0.006);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();
  needlePath(ctx, cx, cy, a, r * tail, r * len, r * 0.009, r * hub, r * 0.004);
  ctx.fillStyle = NEEDLE;
  ctx.fill();
}

function cap(ctx, x, y, r) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  g.addColorStop(0, '#6a6a6a');
  g.addColorStop(0.4, '#202020');
  g.addColorStop(1, '#050505');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
}

export default {
  id: 'boxster',
  name: 'Porsche Boxster (2009)',
  bg: '#0a0a0b',

  layout(W, H) {
    const Rc = Math.min(clamp((W - 70) / 4.62, 240, 360), 0.4 * H);
    const Rs = Rc * 0.8;
    const d = Rc + Rs * 0.64; // the side gauges tuck 36% of their radius behind the tach
    const cx = W / 2, cy = 425;
    const sy = cy + Rc * 0.12;
    const left = { cx: cx - d, cy: sy, r: Rs };
    const right = { cx: cx + d, cy: sy, r: Rs };
    const top = cy - Rc - 26;
    const hood = { x: left.cx - Rs - 26, y: top, w: 2 * (d + Rs + 26), h: sy + Rs + 26 - top };

    const tach = { x: cx - Rc * 0.36, y: cy + Rc * 0.41, w: Rc * 0.72, h: Rc * 0.24 };
    Object.assign(tach, {
      cy: tach.y + tach.h / 2,
      gearRight: tach.x + Rc * 0.2, gearH: Rc * 0.12,
      divX: tach.x + Rc * 0.235,
      speedRight: tach.x + Rc * 0.55, speedH: Rc * 0.14,
      unitX: tach.x + Rc * 0.565,
    });
    const odo = { x: left.cx - Rs * 0.23, y: left.cy + Rs * 0.43, w: Rs * 0.46, h: Rs * 0.17 };
    Object.assign(odo, { cy: odo.y + odo.h / 2, right: odo.x + odo.w - Rs * 0.12, unitX: odo.x + odo.w - Rs * 0.1, digitH: Rs * 0.1 });
    const lap = { x: right.cx - Rs * 0.25, y: right.cy + Rs * 0.6, w: Rs * 0.46, h: Rs * 0.17 };
    Object.assign(lap, { cy: lap.y + lap.h / 2, right: lap.x + lap.w - Rs * 0.05, digitH: Rs * 0.1 });

    return {
      center: { cx, cy, r: Rc }, left, right, hood,
      fuel: { cx: right.cx + Rs * 0.08, cy: right.cy + Rs * 0.3, r: Rs },
      tachLcd: tach, odoLcd: odo, lapLcd: lap,
      stripY: Math.min(H - 30, hood.y + hood.h + 36),
    };
  },

  drawStatic(ctx, L, v) {
    const { center: c, left: l, right: r, hood, view } = L;
    const sc = v.scale;

    ctx.fillStyle = '#0a0a0b';
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

    // Cluster hood
    roundRect(ctx, hood.x, hood.y, hood.w, hood.h, hood.h * 0.5);
    const hg = ctx.createLinearGradient(0, hood.y, 0, hood.y + hood.h);
    hg.addColorStop(0, '#1d1d20');
    hg.addColorStop(0.55, '#121214');
    hg.addColorStop(1, '#0b0b0c');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();

    // Left: speedometer, 0–200 mph (labels every 25) or 0–360 km/h (every 40)
    shadowDisc(ctx, l, L.px, 14);
    gaugeBody(ctx, l);
    const sMax = v.speedMax;
    const label = v.metric ? 40 : 25;
    scale(ctx, l, S0, S1, sMax, [[v.metric ? 10 : 5, 0.85, 0.9, 0.006], [label, 0.78, 0.9, 0.018]], () => false);
    const sf = font(Math.round(l.r * (v.metric ? 0.1 : 0.12)), FONTS.avenir, 500);
    for (let x = 0; x <= sMax; x += label) {
      const a = lerpA(S0, S1, x / sMax);
      text(ctx, String(x), l.cx + Math.cos(a) * l.r * 0.66, l.cy + Math.sin(a) * l.r * 0.66, sf, INK);
    }
    text(ctx, v.metric ? 'km/h' : 'MPH', l.cx, l.cy + l.r * 0.25, font(Math.round(l.r * 0.07), FONTS.avenir, 600), INK_DIM);
    const ol = L.odoLcd;
    lcdBox(ctx, ol);
    sevenSeg(ctx, '888.8', ol.right, ol.cy, ol.digitH, LCD_OFF);
    text(ctx, v.distanceUnit, ol.unitX, ol.cy + ol.digitH * 0.25, font(Math.round(ol.digitH * 0.5), FONTS.avenir, 700), '#b55a18', 'left');

    // Right: boost across the top, fuel at lower right, lap time LCD
    shadowDisc(ctx, r, L.px, 14);
    gaugeBody(ctx, r);
    const bSpan = v.boostMax - v.boostMin;
    const bFine = v.metric ? 0.25 : 5;
    const bLabel = v.metric ? 1 : 10;
    const bn = Math.round(bSpan / bFine);
    ctx.beginPath();
    for (let i = 0; i <= bn; i++) {
      const major = onStep(v.boostMin + i * bFine, bLabel);
      tickPath(ctx, r.cx, r.cy, r.r * (major ? 0.7 : 0.75), r.r * 0.82, lerpA(B0, B1, i / bn));
    }
    ctx.lineWidth = r.r * 0.012;
    ctx.strokeStyle = INK;
    ctx.stroke();
    const bf = font(Math.round(r.r * 0.1), FONTS.avenir, 500);
    for (let i = 0; i <= bn; i++) {
      const x = v.boostMin + i * bFine;
      if (!onStep(x, bLabel)) continue;
      const a = lerpA(B0, B1, i / bn);
      text(ctx, String(x), r.cx + Math.cos(a) * r.r * 0.6, r.cy + Math.sin(a) * r.r * 0.6, bf, INK);
    }
    const lf = font(Math.round(r.r * 0.065), FONTS.avenir, 700);
    text(ctx, 'BOOST', r.cx - r.r * 0.34, r.cy + r.r * 0.02, lf, INK_DIM);
    text(ctx, v.boostUnit, r.cx - r.r * 0.34, r.cy + r.r * 0.12, lf, INK_DIM);

    const fu = L.fuel;
    sector(ctx, fu.cx, fu.cy, fu.r * 0.47, fu.r * 0.5, lerpA(F0, F1, 0.125), F0);
    ctx.fillStyle = RED_INK;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) tickPath(ctx, fu.cx, fu.cy, fu.r * (i % 2 ? 0.44 : 0.4), fu.r * 0.5, lerpA(F0, F1, i / 4));
    ctx.lineWidth = r.r * 0.014;
    ctx.strokeStyle = INK;
    ctx.stroke();
    const ff = font(Math.round(r.r * 0.085), FONTS.avenir, 600);
    for (const [f, s, color] of [[0, 'E', RED_INK], [0.5, '½', INK], [1, 'F', INK]]) {
      const a = lerpA(F0, F1, f);
      text(ctx, s, fu.cx + Math.cos(a) * fu.r * 0.6, fu.cy + Math.sin(a) * fu.r * 0.6, ff, color);
    }
    text(ctx, 'FUEL', fu.cx - fu.r * 0.2, fu.cy + fu.r * 0.14, lf, INK_DIM);
    const ll = L.lapLcd;
    lcdBox(ctx, ll);
    sevenSeg(ctx, '8:88.8', ll.right, ll.cy, ll.digitH, LCD_OFF);

    // Centre: the tach sits in front and shades the gauges behind it
    shadowDisc(ctx, c, L.px, 30);
    gaugeBody(ctx, c);
    sector(ctx, c.cx, c.cy, c.r * 0.86, c.r * 0.9, lerpA(T0, T1, sc.redline / sc.max), T1);
    ctx.fillStyle = RED_INK;
    ctx.fill();
    scale(ctx, c, T0, T1, sc.max, [
      [sc.major / 4, 0.86, 0.91, 0.005],
      [sc.minor, 0.83, 0.91, 0.009],
      [sc.major, 0.77, 0.91, 0.016],
    ], (x) => x >= sc.redline);
    const nf = font(Math.round(c.r * 0.14), FONTS.avenir, 500);
    for (let rpm = 0; rpm <= sc.max + 1; rpm += sc.major) {
      const a = lerpA(T0, T1, rpm / sc.max);
      text(ctx, String(rpm / 1000), c.cx + Math.cos(a) * c.r * 0.66, c.cy + Math.sin(a) * c.r * 0.66, nf, rpm >= sc.redline ? RED_INK : INK);
    }
    text(ctx, '1/min ×1000', c.cx, c.cy - c.r * 0.3, font(Math.round(c.r * 0.045), FONTS.avenir, 600), INK_DIM);
    ctx.beginPath();
    ctx.arc(c.cx, c.cy + c.r * 0.3, c.r * 0.03, 0, TAU);
    ctx.fillStyle = '#6b2a24';
    ctx.fill();

    const tl = L.tachLcd;
    lcdBox(ctx, tl);
    sevenSeg(ctx, '8', tl.gearRight, tl.cy, tl.gearH, LCD_OFF);
    sevenSeg(ctx, '888', tl.speedRight, tl.cy, tl.speedH, LCD_OFF);
    ctx.fillStyle = 'rgba(255,122,26,0.25)';
    ctx.fillRect(tl.divX, tl.y + tl.h * 0.2, 1.5, tl.h * 0.6);
    text(ctx, v.speedUnit, tl.unitX, tl.cy + tl.speedH * 0.3, font(Math.round(c.r * 0.045), FONTS.avenir, 700), '#b55a18', 'left');
  },

  drawDynamic(ctx, L, v) {
    const { center: c, left: l, right: r } = L;

    // Shift lamp
    if (v.live && v.rpmRatio >= 0.96) {
      const lr = Math.round(c.r * 0.035);
      drawSprite(ctx, glowSprite('#ff2a14', lr), c.cx, c.cy + c.r * 0.3, lr);
    }

    // LCDs
    const tl = L.tachLcd;
    sevenSeg(ctx, v.gear, tl.gearRight, tl.cy, tl.gearH, LCD_ON);
    sevenSeg(ctx, fmtSpeed(Math.round(v.speed)), tl.speedRight, tl.cy, tl.speedH, LCD_ON);
    const ol = L.odoLcd;
    sevenSeg(ctx, fmtOdo(Math.round(v.distance * 10) / 10), ol.right, ol.cy, ol.digitH, LCD_ON);
    const ll = L.lapLcd;
    sevenSeg(ctx, fmtLap(Math.round(v.curLap * 10) / 10), ll.right, ll.cy, ll.digitH, LCD_ON);

    // Needles on the gauges behind the tach are clipped where it covers them
    ctx.save();
    clipBehindTach(ctx, l, c, L.view);
    pointer(ctx, l.cx, l.cy, lerpA(S0, S1, v.speedFrac), l.r, 0.84, 0.16, 0.028);
    ctx.restore();
    ctx.save();
    clipBehindTach(ctx, r, c, L.view);
    pointer(ctx, r.cx, r.cy, lerpA(B0, B1, v.boostFrac), r.r, 0.74, 0.14, 0.024);
    pointer(ctx, L.fuel.cx, L.fuel.cy, lerpA(F0, F1, v.fuelFrac), r.r, 0.47, 0.1, 0.02);
    ctx.restore();
    pointer(ctx, c.cx, c.cy, lerpA(T0, T1, v.rpmFrac), c.r, 0.86, 0.18, 0.03);

    // Info strip under the hood
    const f = font(22, FONTS.avenir, 600);
    text(ctx, v.classLine, L.hood.x + 60, L.stripY, f, '#77766f', 'left');
    text(ctx, `${v.lap ? `LAP ${v.lap}   ` : ''}BEST ${fmtBest(v.bestLap)}`, L.hood.x + L.hood.w - 60, L.stripY, f, '#a6a59e', 'right');
  },

  drawGlass(ctx, L) {
    const { center: c, left: l, right: r } = L;
    for (const g of [l, r, c]) {
      ctx.save();
      if (g === c) {
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, g.r * 0.93, 0, TAU);
        ctx.clip();
      } else {
        clipBehindTach(ctx, { cx: g.cx, cy: g.cy, r: g.r * 0.93 }, c, L.view);
      }
      const grad = ctx.createLinearGradient(g.cx - g.r, g.cy - g.r, g.cx + g.r * 0.1, g.cy + g.r * 0.1);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(g.cx - g.r, g.cy - g.r);
      ctx.lineTo(g.cx + g.r * 0.6, g.cy - g.r);
      ctx.lineTo(g.cx - g.r, g.cy + g.r * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    cap(ctx, l.cx, l.cy, l.r * 0.085);
    cap(ctx, r.cx, r.cy, r.r * 0.075);
    cap(ctx, L.fuel.cx, L.fuel.cy, r.r * 0.06);
    cap(ctx, c.cx, c.cy, c.r * 0.08);
  },
};

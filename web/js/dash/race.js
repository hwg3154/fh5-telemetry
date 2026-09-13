// Race car: Hoonicorn / MoTeC-style digital dash.

import { FONTS, font, roundRect, text, blink, glowSprite, drawSprite, clamp, memo } from './common.js';
import { lapTime, lapDelta, signed, tempColor } from '../units.js';

const AMBER = '#ffb000';
const BORDER = '#2a2a2a';
const WHITE = '#f4f4f4';
const LED_COLORS = ['#1ee64a', '#ffb000', '#ff2626'];
const LED_BLUE = '#2f7bff';
const RED = '#ff2a2a';

const fmtCur = memo(lapTime);
const fmtLast = memo(lapTime);
const fmtBest = memo(lapTime);

const box = (x, y, w, h, label) => ({ x, y, w, h, label });

function drawBox(ctx, b, labelColor = AMBER) {
  roundRect(ctx, b.x, b.y, b.w, b.h, 8);
  ctx.fillStyle = '#0a0a0a';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BORDER;
  ctx.stroke();
  if (b.label) text(ctx, b.label, b.x + 14, b.y + 24, font(22, FONTS.cond), labelColor, 'left');
}

export default {
  id: 'race',
  name: 'Race car',
  bg: '#050505',

  layout(W, H) {
    const m = 24;
    const gap = 14;

    const ledSpan = Math.min(W - 2 * m, 1500);
    const ledStep = ledSpan / 15;
    const ledR = Math.min(19, ledStep * 0.3);
    const leds = [];
    for (let i = 0; i < 15; i++) {
      leds.push({ x: W / 2 - ledSpan / 2 + ledStep * (i + 0.5), y: 44, color: LED_COLORS[Math.floor(i / 5)] });
    }

    const rpmBar = { x: m, y: 84, w: W - 2 * m, h: 70 };

    const midY = 206;
    const midH = 438;
    const colW = Math.round(clamp(W * 0.25, 300, 470));
    const bh = (midH - 2 * gap) / 3;
    const left = ['SPEED', 'BOOST', 'FUEL'].map((l, i) => box(m, midY + i * (bh + gap), colW, bh, l));
    const right = ['CURRENT', 'LAST', 'BEST'].map((l, i) => box(W - m - colW, midY + i * (bh + gap), colW, bh, l));
    const gearBox = box(m + colW + gap, midY, W - 2 * m - 2 * colW - 2 * gap, midH, '');

    const botY = midY + midH + gap;
    const botH = H - m - botY;
    const weights = [0.27, 0.13, 0.24, 0.16, 0.2];
    const labels = ['TYRE TEMP', 'PEDALS', 'G-FORCE', 'POS / LAP', 'POWER'];
    const avail = W - 2 * m - gap * (weights.length - 1);
    let x = m;
    const bottom = weights.map((wt, i) => {
      const b = box(x, botY, avail * wt, botH, labels[i]);
      x += b.w + gap;
      return b;
    });
    const [tires, pedals, gbox, poslap, power] = bottom;

    const cellGap = 8;
    const cellW = (tires.w - 28 - cellGap) / 2;
    const cellH = (tires.h - 50 - cellGap) / 2;
    const cells = [0, 1, 2, 3].map((i) => ({
      x: tires.x + 14 + (i % 2) * (cellW + cellGap),
      y: tires.y + 40 + Math.floor(i / 2) * (cellH + cellGap),
      w: cellW,
      h: cellH,
    }));

    return { m, leds, ledR, rpmBar, left, right, gearBox, bottom, tires, pedals, gbox, poslap, power, cells };
  },

  drawStatic(ctx, L, v) {
    const { rpmBar: rb, leds, ledR } = L;
    const sc = v.scale;

    for (const led of leds) {
      ctx.beginPath();
      ctx.arc(led.x, led.y, ledR, 0, Math.PI * 2);
      ctx.fillStyle = '#101010';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1e1e1e';
      ctx.stroke();
    }

    // RPM bar: unlit segments, one per 250 rpm, dark red past the redline.
    const n = Math.round(sc.max / 250);
    const segW = rb.w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i * 250 >= sc.redline ? '#2a0b0b' : '#151515';
      ctx.fillRect(rb.x + i * segW + 1, rb.y, segW - 3, rb.h);
    }
    const labelStep = rb.w / (sc.max / 1000) < 46 ? sc.major : 1000;
    for (let r = 0; r <= sc.max; r += labelStep) {
      const x = clamp(rb.x + (r / sc.max) * rb.w, rb.x + 8, rb.x + rb.w - 8);
      text(ctx, String(r / 1000), x, rb.y + rb.h + 22, font(24, FONTS.cond), r >= sc.redline ? RED : '#9a9a9a');
    }

    for (const b of [...L.left, ...L.right, L.gearBox, ...L.bottom]) drawBox(ctx, b);

    const unit = font(22, FONTS.cond);
    const [speed, boost, fuel] = L.left;
    text(ctx, v.speedUnit.toUpperCase(), speed.x + speed.w - 14, speed.y + 24, unit, '#777', 'right');
    text(ctx, v.boostUnit.toUpperCase(), boost.x + boost.w - 14, boost.y + 24, unit, '#777', 'right');
    text(ctx, '%', fuel.x + fuel.w - 14, fuel.y + 24, unit, '#777', 'right');

    const g = L.gearBox;
    text(ctx, 'RPM', g.x + 16, g.y + 26, font(22, FONTS.cond), AMBER, 'left');

    ['FL', 'FR', 'RL', 'RR'].forEach((name, i) => {
      const c = L.cells[i];
      roundRect(ctx, c.x, c.y, c.w, c.h, 6);
      ctx.fillStyle = '#141414';
      ctx.fill();
    });
    text(ctx, v.tempUnit, L.tires.x + L.tires.w - 14, L.tires.y + 24, unit, '#777', 'right');

    const p = L.pedals;
    const pw = (p.w - 42) / 2;
    for (let i = 0; i < 2; i++) {
      const x = p.x + 14 + i * (pw + 14);
      ctx.fillStyle = '#151515';
      ctx.fillRect(x, p.y + 42, pw, p.h - 84);
      text(ctx, i ? 'BRK' : 'THR', x + pw / 2, p.y + p.h - 22, font(20, FONTS.cond), '#8a8a8a');
    }

    const gb = L.gbox;
    text(ctx, 'LAT', gb.x + 14, gb.y + 70, font(24, FONTS.cond), '#8a8a8a', 'left');
    text(ctx, 'LONG', gb.x + 14, gb.y + 136, font(24, FONTS.cond), '#8a8a8a', 'left');
    for (const y of [gb.y + 98, gb.y + 164]) {
      ctx.fillStyle = '#151515';
      ctx.fillRect(gb.x + 14, y, gb.w - 28, 8);
      ctx.fillStyle = '#444';
      ctx.fillRect(gb.x + gb.w / 2 - 1, y - 3, 2, 14);
    }

    const pl = L.poslap;
    text(ctx, 'P', pl.x + 16, pl.y + 84, font(30, FONTS.cond), '#8a8a8a', 'left');
    text(ctx, 'L', pl.x + 16, pl.y + 150, font(30, FONTS.cond), '#8a8a8a', 'left');

    const pwr = L.power;
    text(ctx, v.powerUnit.toUpperCase(), pwr.x + pwr.w - 14, pwr.y + 24, unit, '#777', 'right');
  },

  drawDynamic(ctx, L, v) {
    const { rpmBar: rb, leds, ledR } = L;
    const sc = v.scale;
    const t = v.t;
    const limiterOn = v.limiter && blink(t, 8);

    // Shift LEDs, all flashing blue at the limiter.
    if (v.limiter) {
      if (limiterOn) {
        const s = glowSprite(LED_BLUE, ledR);
        for (const led of leds) drawSprite(ctx, s, led.x, led.y, ledR);
      }
    } else {
      const lit = Math.round(v.shift * 15);
      for (let i = 0; i < lit; i++) drawSprite(ctx, glowSprite(leds[i].color, ledR), leds[i].x, leds[i].y, ledR);
    }

    // RPM bar: white below 75%, amber up to the redline, red above.
    const rpm = v.rpmFrac * sc.max;
    const n = Math.round(sc.max / 250);
    const segW = rb.w / n;
    const white = sc.rpmMax * 0.75;
    for (const [color, lo, hi] of [[WHITE, 0, white], [AMBER, white, sc.redline], [RED, sc.redline, Infinity]]) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const r0 = i * 250;
        if (r0 >= rpm) break;
        if (r0 < lo || r0 >= hi) continue;
        ctx.rect(rb.x + i * segW + 1, rb.y, segW - 3, rb.h);
      }
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Gear
    const g = L.gearBox;
    if (limiterOn) {
      roundRect(ctx, g.x + 3, g.y + 3, g.w - 6, g.h - 6, 8);
      ctx.lineWidth = 6;
      ctx.strokeStyle = RED;
      ctx.stroke();
    }
    const gearSize = Math.min(380, g.w * 1.1);
    text(ctx, v.gear, g.x + g.w / 2, g.y + g.h / 2 + gearSize * 0.08, font(gearSize, FONTS.cond), limiterOn ? RED : WHITE);
    text(ctx, String(Math.round(v.rpmRaw)), g.x + g.w - 16, g.y + 30, font(40, FONTS.cond), WHITE, 'right');
    text(ctx, v.classLine, g.x + g.w / 2, g.y + g.h - 24, font(26, FONTS.cond), '#8a8a8a');

    // Left column
    const [speed, boost, fuel] = L.left;
    const big = font(Math.min(104, speed.h * 0.78), FONTS.cond);
    const valY = (b) => b.y + b.h / 2 + 18;
    text(ctx, String(Math.round(v.speed)), speed.x + speed.w - 16, valY(speed), big, WHITE, 'right');
    text(ctx, v.boost.toFixed(v.metric ? 2 : 1), boost.x + boost.w - 16, valY(boost), big, v.boost > 0 ? WHITE : '#9a9a9a', 'right');
    const fuelColor = v.fuel < 0.1 ? RED : v.fuel < 0.25 ? AMBER : WHITE;
    text(ctx, v.live ? String(Math.round(v.fuel * 100)) : '—', fuel.x + fuel.w - 16, valY(fuel) - 6, big, v.live ? fuelColor : '#555', 'right');
    ctx.fillStyle = '#151515';
    ctx.fillRect(fuel.x + 14, fuel.y + fuel.h - 20, fuel.w - 28, 8);
    ctx.fillStyle = fuelColor;
    ctx.fillRect(fuel.x + 14, fuel.y + fuel.h - 20, (fuel.w - 28) * clamp(v.fuel, 0, 1), 8);

    // Right column
    const [cur, lastB, best] = L.right;
    const timeFont = font(Math.min(78, cur.w * 0.19), FONTS.cond);
    text(ctx, fmtCur(Math.round(v.curLap * 1000) / 1000), cur.x + cur.w - 16, valY(cur), timeFont, WHITE, 'right');
    text(ctx, fmtLast(v.lastLap), lastB.x + lastB.w - 16, valY(lastB), timeFont, WHITE, 'right');
    if (v.lastLap > 0 && v.bestLap > 0) {
      const d = v.lastLap - v.bestLap;
      text(ctx, d <= 0.0005 ? 'BEST' : lapDelta(d), lastB.x + lastB.w - 16, lastB.y + 24, font(24, FONTS.cond), d <= 0.0005 ? '#1ee64a' : AMBER, 'right');
    }
    text(ctx, fmtBest(v.bestLap), best.x + best.w - 16, valY(best), timeFont, '#c9a2ff', 'right');

    // Tires
    L.cells.forEach((c, i) => {
      if (v.live) {
        roundRect(ctx, c.x, c.y, c.w, c.h, 6);
        ctx.fillStyle = tempColor(v.tireTempF[i], 0.9);
        ctx.fill();
      }
      text(ctx, v.live ? String(Math.round(v.tireTemp[i])) : '—', c.x + c.w / 2, c.y + c.h / 2 + 5, font(Math.min(46, c.h * 0.7), FONTS.cond), v.live ? '#050505' : '#555');
    });

    // Pedals
    const p = L.pedals;
    const pw = (p.w - 42) / 2;
    const ph = p.h - 84;
    ctx.fillStyle = '#1ee64a';
    ctx.fillRect(p.x + 14, p.y + 42 + ph * (1 - v.throttle), pw, ph * v.throttle);
    ctx.fillStyle = RED;
    ctx.fillRect(p.x + 28 + pw, p.y + 42 + ph * (1 - v.brake), pw, ph * v.brake);

    // G-force
    const gb = L.gbox;
    const gFont = font(40, FONTS.cond);
    text(ctx, signed(v.gLat, 2), gb.x + gb.w - 14, gb.y + 72, gFont, WHITE, 'right');
    text(ctx, signed(v.gLon, 2), gb.x + gb.w - 14, gb.y + 138, gFont, WHITE, 'right');
    const half = (gb.w - 28) / 2;
    ctx.fillStyle = AMBER;
    for (const [val, y] of [[v.gLat, gb.y + 98], [v.gLon, gb.y + 164]]) {
      const w = half * clamp(val / 2, -1, 1);
      ctx.fillRect(gb.x + gb.w / 2 + Math.min(0, w), y, Math.abs(w), 8);
    }

    // Position / lap
    const pl = L.poslap;
    const plFont = font(Math.min(60, pl.w * 0.3), FONTS.cond);
    text(ctx, v.position ? String(v.position) : '—', pl.x + pl.w - 16, pl.y + 86, plFont, WHITE, 'right');
    text(ctx, v.lap ? String(v.lap) : '—', pl.x + pl.w - 16, pl.y + 152, plFont, WHITE, 'right');

    // Power
    const pwr = L.power;
    text(ctx, String(Math.round(v.power)), pwr.x + pwr.w - 16, pwr.y + 100, font(Math.min(84, pwr.w * 0.34), FONTS.cond), WHITE, 'right');
    text(ctx, `${Math.round(v.torque)} ${v.torqueUnit.toUpperCase()}`, pwr.x + pwr.w - 16, pwr.y + pwr.h - 26, font(28, FONTS.cond), '#9a9a9a', 'right');
  },
};

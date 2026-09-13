// Modern Ford (S650 Mustang digital cluster inspired): a wide arced rpm tape
// over huge italic speed digits, with glassy cards along the bottom.

import { FONTS, font, roundRect, tickPath, text, blink, glowSprite, drawSprite, clamp, DEG, TAU, memo, gFelt } from './common.js';
import { lapTime } from '../units.js';

const BLUE = '#1f6fff';
const CYAN = '#39c6ff';
const A0 = 198 * DEG;
const A1 = 342 * DEG;
const THICK = 54;

const fmtCur = memo(lapTime);
const fmtBest = memo(lapTime);

const angle = (frac) => A0 + (A1 - A0) * clamp(frac, 0, 1);

let tapeGrad = null;
let tapeGradKey = '';

function card(ctx, c, label) {
  roundRect(ctx, c.x, c.y, c.w, c.h, 14);
  const g = ctx.createLinearGradient(0, c.y, 0, c.y + c.h);
  g.addColorStop(0, 'rgba(140,180,255,0.10)');
  g.addColorStop(1, 'rgba(140,180,255,0.025)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(120,170,255,0.18)';
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BLUE;
  ctx.fillRect(c.x, c.y, c.w, 3);
  ctx.restore();
  text(ctx, label, c.x + 18, c.y + 30, font(19, FONTS.avenir, 600), '#8fb3ff', 'left');
}

export default {
  id: 'ford',
  name: 'Modern Ford',
  bg: '#02050b',

  layout(W, H) {
    // DESIGN.md says W/2 − 70; the outer numerals need ~55 more to stay on screen.
    const R = Math.min(640, (W / 2 - 125) / 0.951);
    const cx = W / 2;
    const cy = 110 + R;

    const m = 40;
    const gap = 16;
    const cardY = 690;
    const cardH = H - 28 - cardY;
    const cw = (W - 2 * m - gap * 4) / 5;
    const cards = [0, 1, 2, 3, 4].map((i) => ({ x: m + i * (cw + gap), y: cardY, w: cw, h: cardH }));

    const side = Math.min(290, W * 0.19);
    const gear = { x: cx + side, y: 350, w: 124, h: 150 };
    const gm = { cx: cx - side - 62, cy: 425, r: 72 }; // G-meter mirrors the gear box
    return { R, cx, cy, cards, gear, gm, speedY: 450 };
  },

  drawStatic(ctx, L, v) {
    const { R, cx, cy, view } = L;
    const sc = v.scale;
    const vw = view.x1 - view.x0;

    const bg = ctx.createRadialGradient(cx, 430, 0, cx, 430, Math.max(vw, 900) * 0.72);
    bg.addColorStop(0, '#0b2140');
    bg.addColorStop(1, '#02050b');
    ctx.fillStyle = bg;
    ctx.fillRect(view.x0, view.y0, vw, view.y1 - view.y0);

    // Horizon glow line
    const hy = 640;
    const glow = ctx.createLinearGradient(0, hy - 40, 0, hy + 40);
    glow.addColorStop(0, 'rgba(40,110,255,0)');
    glow.addColorStop(0.5, 'rgba(40,110,255,0.12)');
    glow.addColorStop(1, 'rgba(40,110,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(view.x0, hy - 40, vw, 80);
    const line = ctx.createLinearGradient(view.x0, 0, view.x1, 0);
    line.addColorStop(0, 'rgba(80,150,255,0)');
    line.addColorStop(0.5, 'rgba(110,175,255,0.6)');
    line.addColorStop(1, 'rgba(80,150,255,0)');
    ctx.fillStyle = line;
    ctx.fillRect(view.x0, hy - 1, vw, 2);

    // Tape background, tinted past the redline
    const red = angle(sc.redline / sc.max);
    ctx.lineWidth = THICK;
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, red);
    ctx.strokeStyle = '#08162c';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R, red, A1);
    ctx.strokeStyle = '#2c0a16';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(90,150,255,0.28)';
    for (const r of [R - THICK / 2 - 1, R + THICK / 2 + 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, A0, A1);
      ctx.stroke();
    }

    // Ticks and numbers outside the arc
    ctx.beginPath();
    for (let r = 0; r <= sc.max + 1; r += sc.minor) {
      if (r % sc.major) tickPath(ctx, cx, cy, R + 34, R + 42, angle(r / sc.max));
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5f7eaa';
    ctx.stroke();
    ctx.beginPath();
    for (let r = 0; r <= sc.max + 1; r += sc.major) tickPath(ctx, cx, cy, R + 34, R + 48, angle(r / sc.max));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#cfe0ff';
    ctx.stroke();
    const numFont = font(28, FONTS.avenir, 600);
    for (let r = 0; r <= sc.max + 1; r += sc.major) {
      const a = angle(r / sc.max);
      text(ctx, String(r / 1000), cx + Math.cos(a) * (R + 70), cy + Math.sin(a) * (R + 70), numFont, r >= sc.redline ? '#ff5a5a' : '#dfeaff');
    }

    text(ctx, 'RPM', cx, 282, font(18, FONTS.avenir, 600), '#6f8fc2');
    text(ctx, v.speedUnit.toUpperCase(), cx - 20, L.speedY + 128, font(30, FONTS.avenir, 600), '#8fb3ff');

    const g = L.gear;
    roundRect(ctx, g.x, g.y, g.w, g.h, 16);
    ctx.fillStyle = 'rgba(10,30,70,0.55)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    text(ctx, 'GEAR', g.x + g.w / 2, g.y - 18, font(16, FONTS.avenir, 600), '#6f8fc2');

    const gm = L.gm;
    const gk = (gm.r * 0.86) / 1.5;
    ctx.beginPath();
    ctx.arc(gm.cx, gm.cy, gm.r, 0, TAU);
    ctx.fillStyle = 'rgba(10,30,70,0.55)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = BLUE;
    ctx.stroke();
    ctx.beginPath();
    for (const ring of [0.5, 1]) {
      ctx.moveTo(gm.cx + ring * gk, gm.cy);
      ctx.arc(gm.cx, gm.cy, ring * gk, 0, TAU);
    }
    ctx.moveTo(gm.cx - gm.r * 0.86, gm.cy);
    ctx.lineTo(gm.cx + gm.r * 0.86, gm.cy);
    ctx.moveTo(gm.cx, gm.cy - gm.r * 0.86);
    ctx.lineTo(gm.cx, gm.cy + gm.r * 0.86);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(143,179,255,0.28)';
    ctx.stroke();
    text(ctx, 'G-FORCE', gm.cx, g.y - 18, font(16, FONTS.avenir, 600), '#6f8fc2');

    const [boost, power, inputs, lap, fuel] = L.cards;
    card(ctx, boost, 'BOOST');
    card(ctx, power, 'POWER');
    card(ctx, inputs, 'INPUTS');
    card(ctx, lap, 'LAP');
    card(ctx, fuel, 'FUEL');

    const unit = font(18, FONTS.avenir, 600);
    text(ctx, v.boostUnit, boost.x + boost.w - 18, boost.y + 30, unit, '#6f8fc2', 'right');
    text(ctx, v.powerUnit, power.x + power.w - 18, power.y + 30, unit, '#6f8fc2', 'right');

    const barW = (c) => c.w - 36;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(boost.x + 18, boost.y + boost.h - 34, barW(boost), 10);
    ctx.fillRect(inputs.x + 18, inputs.y + 54, barW(inputs), 10);
    ctx.fillRect(inputs.x + 18, inputs.y + 80, barW(inputs), 10);
    ctx.fillRect(fuel.x + 18, fuel.y + fuel.h - 34, barW(fuel), 10);
    const zero = -v.boostMin / (v.boostMax - v.boostMin);
    ctx.fillStyle = '#8fb3ff';
    ctx.fillRect(boost.x + 18 + barW(boost) * zero - 1, boost.y + boost.h - 38, 2, 18);
  },

  drawDynamic(ctx, L, v) {
    const { R, cx, cy } = L;
    const sc = v.scale;
    const t = v.t;
    const a = angle(v.rpmFrac);

    // Horizontal gradient: Ford blue → cyan → orange → red at the redline
    const key = `${sc.max}|${sc.redline}|${R}`;
    if (key !== tapeGradKey) {
      const xl = cx + Math.cos(A0) * R;
      const xr = cx + Math.cos(A1) * R;
      const at = (rpm) => clamp((cx + Math.cos(angle(rpm / sc.max)) * R - xl) / (xr - xl), 0, 1);
      const red = at(sc.redline);
      const orange = Math.min(at(Math.max(0, sc.redline - sc.major)), red - 0.01);
      tapeGrad = ctx.createLinearGradient(xl, 0, xr, 0);
      tapeGrad.addColorStop(0, BLUE);
      tapeGrad.addColorStop(Math.min(at(sc.max * 0.5), orange - 0.01), CYAN);
      tapeGrad.addColorStop(orange, '#ff8a00');
      tapeGrad.addColorStop(red, '#ff2a1a');
      tapeGrad.addColorStop(1, '#ff2a1a');
      tapeGradKey = key;
    }

    if (a > A0 + 0.001) {
      ctx.strokeStyle = tapeGrad;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = THICK + 26;
      ctx.beginPath();
      ctx.arc(cx, cy, R, A0, a);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = THICK;
      ctx.beginPath();
      ctx.arc(cx, cy, R, A0, a);
      ctx.stroke();
    }

    if (v.limiter) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 28);
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
      drawSprite(ctx, glowSprite('#ff3a20', 34), cx + Math.cos(a) * R, cy + Math.sin(a) * R, 34);
      ctx.globalAlpha = 1;
      if (blink(t, 6)) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ff3030';
        ctx.beginPath();
        ctx.arc(cx, cy, R + THICK / 2 + 3, A0, A1);
        ctx.arc(cx, cy, R - THICK / 2 - 3, A1, A0, true);
        ctx.closePath();
        ctx.stroke();
      }
    }

    text(ctx, String(Math.round(v.rpmRaw)), cx, 250, font(40, FONTS.avenir, 600, 'italic'), '#dfeaff');

    // Speed
    text(ctx, String(Math.round(v.speed)), cx - 20, L.speedY, font(250, FONTS.avenir, 700, 'italic'), '#fff');

    const g = L.gear;
    text(ctx, v.gear, g.x + g.w / 2, g.y + g.h / 2 + 6, font(112, FONTS.avenir, 700, 'italic'), v.gear === 'R' ? '#ff6a5a' : '#fff');

    const gm = L.gm;
    const gk = (gm.r * 0.86) / 1.5;
    const gd = gFelt(v.gLat, v.gLon, 1.5);
    drawSprite(ctx, glowSprite(CYAN, 7), gm.cx + gd[0] * gk, gm.cy + gd[1] * gk, 7);
    text(ctx, `${Math.hypot(v.gLat, v.gLon).toFixed(2)} g`, gm.cx, gm.cy + gm.r + 24, font(22, FONTS.avenir, 600, 'italic'), '#dfeaff');

    const [boost, power, inputs, lap, fuel] = L.cards;
    const barW = (c) => c.w - 36;
    const val = (c, s, color = '#fff') => text(ctx, s, c.x + 18, c.y + 82, font(Math.min(50, c.w * 0.2), FONTS.avenir, 600, 'italic'), color, 'left');

    // Boost
    val(boost, v.boost.toFixed(v.metric ? 2 : 1));
    const zero = -v.boostMin / (v.boostMax - v.boostMin);
    const bf = v.boostFrac;
    ctx.fillStyle = bf >= zero ? CYAN : '#5a78a8';
    const bx0 = boost.x + 18 + barW(boost) * Math.min(bf, zero);
    ctx.fillRect(bx0, boost.y + boost.h - 34, barW(boost) * Math.abs(bf - zero), 10);

    // Power
    val(power, String(Math.round(v.power)));
    text(ctx, `${Math.round(v.torque)} ${v.torqueUnit}`, power.x + 18, power.y + power.h - 30, font(22, FONTS.avenir, 600), '#8fb3ff', 'left');

    // Inputs
    ctx.fillStyle = CYAN;
    ctx.fillRect(inputs.x + 18, inputs.y + 54, barW(inputs) * clamp(v.throttle, 0, 1), 10);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(inputs.x + 18, inputs.y + 80, barW(inputs) * clamp(v.brake, 0, 1), 10);
    text(ctx, v.classLine, inputs.x + 18, inputs.y + inputs.h - 30, font(Math.min(24, inputs.w * 0.1), FONTS.avenir, 600), '#dfeaff', 'left');

    // Lap
    text(ctx, fmtCur(Math.round(v.curLap * 1000) / 1000), lap.x + 18, lap.y + 82, font(Math.min(44, lap.w * 0.17), FONTS.avenir, 600, 'italic'), '#fff', 'left');
    text(ctx, `BEST ${fmtBest(v.bestLap)}`, lap.x + 18, lap.y + lap.h - 30, font(Math.min(22, lap.w * 0.085), FONTS.avenir, 600), '#8fb3ff', 'left');
    if (v.lap) text(ctx, `L${v.lap}`, lap.x + lap.w - 18, lap.y + 30, font(19, FONTS.avenir, 700), '#dfeaff', 'right');

    // Fuel
    const low = v.fuel < 0.15;
    val(fuel, `${Math.round(v.fuel * 100)}%`, low ? '#ffb000' : '#fff');
    ctx.fillStyle = low ? '#ffb000' : BLUE;
    ctx.fillRect(fuel.x + 18, fuel.y + fuel.h - 34, barW(fuel) * v.fuelFrac, 10);
  },

  drawGlass(ctx, L, v) {
    const { R, cx, cy } = L;
    const sc = v.scale;
    const step = sc.max / 250 <= 80 ? 250 : sc.minor;
    ctx.beginPath();
    for (let r = step; r < sc.max; r += step) tickPath(ctx, cx, cy, R - THICK / 2, R + THICK / 2, angle(r / sc.max));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#040b18';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R - THICK / 2 + 6, A0, A1);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();
  },
};

// Modern Porsche (992 / Taycan inspired): central tach with a floating needle,
// side "screens" for boost/power/fuel and a Sport Chrono G-meter with laps.

import { FONTS, font, roundRect, sector, tickPath, text, blink, glowSprite, drawSprite, clamp, DEG, memo } from './common.js';
import { lapTime } from '../units.js';

const RED = '#d5001c';
const NEEDLE = '#ff3219';
const A0 = 135 * DEG;
const A1 = 405 * DEG;
const BOOST_A0 = 150 * DEG;
const BOOST_A1 = 390 * DEG;

const fmtCur = memo(lapTime);
const fmtLast = memo(lapTime);
const fmtBest = memo(lapTime);

const angle = (frac) => A0 + (A1 - A0) * clamp(frac, 0, 1);

export default {
  id: 'porsche',
  name: 'Modern Porsche',
  bg: '#000',

  layout(W, H) {
    const R = Math.min(390, 0.26 * W, 0.46 * H);
    const cx = W / 2;
    const cy = Math.min(450, 810 - R);
    const bezel = R * 0.045;

    const region = cx - R - 48;
    const pw = Math.min(440, region);
    const ph = 560;
    const py = cy - ph / 2;
    const left = { x: 24 + (region - pw) / 2, y: py, w: pw, h: ph };
    const right = { x: W - 24 - (region - pw) / 2 - pw, y: py, w: pw, h: ph };

    const boost = { cx: left.x + pw / 2, cy: py + 150, r: Math.min(pw * 0.34, 100) };
    const gm = { cx: right.x + pw / 2, cy: py + 150, r: Math.min(pw * 0.38, 112) };

    return { R, cx, cy, bezel, left, right, boost, gm, barW: R * 0.9, barY: cy + R + 26 };
  },

  drawStatic(ctx, L, v) {
    const { R, cx, cy, bezel, view } = L;
    const sc = v.scale;

    // Background with a soft vignette
    const bg = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, Math.max(view.x1 - view.x0, view.y1 - view.y0) * 0.7);
    bg.addColorStop(0, '#15151a');
    bg.addColorStop(1, '#000');
    ctx.fillStyle = bg;
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

    // Face
    const face = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R);
    face.addColorStop(0, '#141417');
    face.addColorStop(1, '#040405');
    ctx.beginPath();
    ctx.arc(cx, cy, R - bezel, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();

    // Brushed-silver bezel
    const silver = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    ['#4d5057', '#e9ebef', '#80848c', '#f6f7f9', '#5d6168', '#c9ccd2', '#484b51'].forEach((c, i, a) => silver.addColorStop(i / (a.length - 1), c));
    ctx.beginPath();
    ctx.arc(cx, cy, R - bezel / 2, 0, Math.PI * 2);
    ctx.lineWidth = bezel;
    ctx.strokeStyle = silver;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R - bezel, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.stroke();

    // Redline band
    sector(ctx, cx, cy, R * 0.905, R * 0.935, angle(sc.redline / sc.max), A1);
    ctx.fillStyle = RED;
    ctx.fill();

    // Ticks
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (let r = 0; r <= sc.max + 1; r += sc.minor) {
      if (r % sc.major === 0) continue;
      tickPath(ctx, cx, cy, R * 0.855, R * 0.9, angle(r / sc.max));
    }
    ctx.lineWidth = R * 0.008;
    ctx.strokeStyle = '#b9b9be';
    ctx.stroke();
    ctx.beginPath();
    for (let r = 0; r <= sc.max + 1; r += sc.major) tickPath(ctx, cx, cy, R * 0.8, R * 0.9, angle(r / sc.max));
    ctx.lineWidth = R * 0.016;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Numerals
    const numFont = font(Math.round(R * 0.13), FONTS.avenir, 600);
    for (let r = 0; r <= sc.max + 1; r += sc.major) {
      const a = angle(r / sc.max);
      text(ctx, String(r / 1000), cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68, numFont, r >= sc.redline ? '#ff2a3a' : '#fff');
    }

    text(ctx, 'RPM ×1000', cx, cy - R * 0.36, font(Math.round(R * 0.055), FONTS.avenir, 600), '#8b8b92');
    text(ctx, v.speedUnit, cx, cy + R * 0.19, font(Math.round(R * 0.07), FONTS.avenir, 600), '#9a9aa2');

    // Gear box
    roundRect(ctx, cx - R * 0.13, cy + R * 0.3, R * 0.26, R * 0.22, R * 0.04);
    ctx.fillStyle = '#0d0d10';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3a3a40';
    ctx.stroke();

    // Throttle / brake tracks
    const bx = cx - L.barW / 2;
    for (let i = 0; i < 2; i++) {
      roundRect(ctx, bx, L.barY + i * 16, L.barW, 7, 3.5);
      ctx.fillStyle = '#1b1b20';
      ctx.fill();
    }
    text(ctx, 'THR', bx - 12, L.barY + 3.5, font(15, FONTS.avenir, 600), '#77777e', 'right');
    text(ctx, 'BRK', bx - 12, L.barY + 19.5, font(15, FONTS.avenir, 600), '#77777e', 'right');

    // Side panels
    for (const p of [L.left, L.right]) {
      roundRect(ctx, p.x, p.y, p.w, p.h, 22);
      const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      g.addColorStop(0, '#111115');
      g.addColorStop(1, '#08080a');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#24242a';
      ctx.stroke();
    }

    const label = font(17, FONTS.avenir, 600);
    const muted = '#7d7d85';
    const lp = L.left;
    const pad = 24;

    // Boost arc
    const b = L.boost;
    text(ctx, 'BOOST', lp.x + pad, lp.y + 34, label, muted, 'left');
    ctx.beginPath();
    ctx.arc(b.cx, b.cy, b.r, BOOST_A0, BOOST_A1);
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1d1d23';
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    const steps = 6;
    for (let i = 0; i <= steps; i++) tickPath(ctx, b.cx, b.cy, b.r - 22, b.r - 14, BOOST_A0 + ((BOOST_A1 - BOOST_A0) * i) / steps);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#55555c';
    ctx.stroke();
    text(ctx, v.boostUnit, b.cx, b.cy + 34, font(16, FONTS.avenir, 600), muted);

    text(ctx, 'POWER', lp.x + pad, lp.y + 304, label, muted, 'left');
    text(ctx, v.powerUnit, lp.x + lp.w - pad, lp.y + 304, label, muted, 'right');
    text(ctx, 'TORQUE', lp.x + pad, lp.y + 394, label, muted, 'left');
    text(ctx, v.torqueUnit, lp.x + lp.w - pad, lp.y + 394, label, muted, 'right');
    text(ctx, 'FUEL', lp.x + pad, lp.y + 486, label, muted, 'left');
    roundRect(ctx, lp.x + pad, lp.y + 510, lp.w - pad * 2, 10, 5);
    ctx.fillStyle = '#1d1d23';
    ctx.fill();

    // G-meter
    const rp = L.right;
    const gm = L.gm;
    text(ctx, 'G-FORCE', rp.x + pad, rp.y + 34, label, muted, 'left');
    ctx.beginPath();
    for (const g of [0.5, 1, 1.5]) {
      ctx.moveTo(gm.cx + (gm.r * g) / 1.5, gm.cy);
      ctx.arc(gm.cx, gm.cy, (gm.r * g) / 1.5, 0, Math.PI * 2);
    }
    ctx.moveTo(gm.cx - gm.r, gm.cy);
    ctx.lineTo(gm.cx + gm.r, gm.cy);
    ctx.moveTo(gm.cx, gm.cy - gm.r);
    ctx.lineTo(gm.cx, gm.cy + gm.r);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2c2c33';
    ctx.stroke();
    text(ctx, '1.0', gm.cx + (gm.r / 1.5) * 0.72, gm.cy - (gm.r / 1.5) * 0.72, font(12, FONTS.avenir, 600), '#55555c');

    text(ctx, 'LAP', rp.x + pad, rp.y + 304, label, muted, 'left');
    text(ctx, 'LAST', rp.x + pad, rp.y + 438, label, muted, 'left');
    text(ctx, 'BEST', rp.x + pad, rp.y + 482, label, muted, 'left');
  },

  drawDynamic(ctx, L, v) {
    const { R, cx, cy, bezel } = L;
    const t = v.t;
    const a = angle(v.rpmFrac);

    // Limiter: bezel ring flashes red
    if (v.live && v.rpmRatio >= 0.965 && blink(t, 10)) {
      ctx.beginPath();
      ctx.arc(cx, cy, R - bezel / 2, 0, Math.PI * 2);
      ctx.lineWidth = bezel + 2;
      ctx.strokeStyle = 'rgba(255,26,26,0.92)';
      ctx.stroke();
    }

    // Sweep trail behind the needle
    if (a > A0 + 0.002) {
      sector(ctx, cx, cy, R * 0.52, R * 0.9, A0, a);
      ctx.fillStyle = 'rgba(255,50,25,0.08)';
      ctx.fill();
      sector(ctx, cx, cy, R * 0.52, R * 0.9, Math.max(A0, a - 14 * DEG), a);
      ctx.fillStyle = 'rgba(255,50,25,0.14)';
      ctx.fill();
    }

    // Floating tapered needle, no hub
    const c = Math.cos(a), s = Math.sin(a);
    const r0 = R * 0.52, r1 = R * 0.965;
    const w0 = R * 0.02, w1 = R * 0.006;
    ctx.beginPath();
    ctx.moveTo(cx + c * r0 - s * w0, cy + s * r0 + c * w0);
    ctx.lineTo(cx + c * r1 - s * w1, cy + s * r1 + c * w1);
    ctx.lineTo(cx + c * r1 + s * w1, cy + s * r1 - c * w1);
    ctx.lineTo(cx + c * r0 + s * w0, cy + s * r0 - c * w0);
    ctx.closePath();
    ctx.shadowColor = 'rgba(255,50,25,0.85)';
    ctx.shadowBlur = 14 * L.px;
    ctx.fillStyle = NEEDLE;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Speed and gear
    text(ctx, String(Math.round(v.speed)), cx, cy + R * 0.0, font(Math.round(R * 0.36), FONTS.avenir, 600), '#fff');
    text(ctx, v.gear, cx, cy + R * 0.415, font(Math.round(R * 0.16), FONTS.avenir, 700), v.gear === 'R' ? '#ff4b3a' : '#fff');

    // Throttle / brake
    const bx = cx - L.barW / 2;
    if (v.throttle > 0.005) {
      roundRect(ctx, bx, L.barY, L.barW * clamp(v.throttle, 0, 1), 7, 3.5);
      ctx.fillStyle = '#f2f2f2';
      ctx.fill();
    }
    if (v.brake > 0.005) {
      roundRect(ctx, bx, L.barY + 16, L.barW * clamp(v.brake, 0, 1), 7, 3.5);
      ctx.fillStyle = '#ff2a3a';
      ctx.fill();
    }
    text(ctx, v.classLine, cx, L.barY + 52, font(20, FONTS.avenir, 600), '#8b8b92');

    const pad = 24;
    const lp = L.left;

    // Boost
    const b = L.boost;
    const zeroFrac = -v.boostMin / (v.boostMax - v.boostMin);
    const ba = (f) => BOOST_A0 + (BOOST_A1 - BOOST_A0) * clamp(f, 0, 1);
    const bf = v.boostFrac;
    if (Math.abs(bf - zeroFrac) > 0.003) {
      ctx.beginPath();
      ctx.arc(b.cx, b.cy, b.r, ba(Math.min(bf, zeroFrac)), ba(Math.max(bf, zeroFrac)));
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.strokeStyle = bf > zeroFrac ? '#f2f2f2' : '#6b6b73';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    text(ctx, v.boost.toFixed(v.metric ? 2 : 1), b.cx, b.cy + 2, font(Math.round(b.r * 0.42), FONTS.avenir, 600), '#fff');

    const valFont = font(Math.min(46, lp.w * 0.17), FONTS.avenir, 600);
    text(ctx, String(Math.round(v.power)), lp.x + lp.w - pad, lp.y + 346, valFont, '#fff', 'right');
    text(ctx, String(Math.round(v.torque)), lp.x + lp.w - pad, lp.y + 436, valFont, '#fff', 'right');

    const fuelLow = v.fuel < 0.15;
    const fw = lp.w - pad * 2;
    if (v.fuelFrac > 0.005) {
      roundRect(ctx, lp.x + pad, lp.y + 510, fw * v.fuelFrac, 10, 5);
      ctx.fillStyle = fuelLow ? '#ffb000' : '#f2f2f2';
      ctx.fill();
    }
    text(ctx, `${Math.round(v.fuel * 100)}%`, lp.x + lp.w - pad, lp.y + 486, font(17, FONTS.avenir, 600), fuelLow ? '#ffb000' : '#cfcfd4', 'right');

    // G-meter dot: shows the force you feel (braking → up, right turn → left)
    const gm = L.gm;
    const k = gm.r / 1.5;
    let gx = -v.gLat, gy = -v.gLon;
    const mag = Math.hypot(gx, gy);
    if (mag > 1.6) {
      gx *= 1.6 / mag;
      gy *= 1.6 / mag;
    }
    drawSprite(ctx, glowSprite('#ff3219', 9), gm.cx + gx * k, gm.cy + gy * k, 9);
    text(ctx, `${Math.hypot(v.gLat, v.gLon).toFixed(2)} g`, gm.cx, gm.cy + gm.r + 30, font(20, FONTS.avenir, 600), '#cfcfd4');

    // Laps
    const rp = L.right;
    text(ctx, v.lap ? String(v.lap) : '—', rp.x + pad + 44, rp.y + 304, font(17, FONTS.avenir, 700), '#fff', 'left');
    if (v.position) text(ctx, `P${v.position}`, rp.x + rp.w - pad, rp.y + 304, font(17, FONTS.avenir, 700), '#fff', 'right');
    text(ctx, fmtCur(Math.round(v.curLap * 1000) / 1000), rp.x + rp.w / 2, rp.y + 360, font(Math.min(54, rp.w * 0.2), FONTS.avenir, 600), '#fff');
    const small = font(Math.min(26, rp.w * 0.1), FONTS.avenir, 600);
    text(ctx, fmtLast(v.lastLap), rp.x + rp.w - pad, rp.y + 438, small, '#e6e6ea', 'right');
    text(ctx, fmtBest(v.bestLap), rp.x + rp.w - pad, rp.y + 482, small, '#c9a2ff', 'right');
  },

  drawGlass(ctx, L) {
    const { R, cx, cy, bezel } = L;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - bezel, 0, Math.PI * 2);
    ctx.clip();
    const g = ctx.createLinearGradient(0, cy - R, 0, cy);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy - R * 0.55, R * 0.95, R * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};

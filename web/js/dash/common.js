// Drawing helpers, fonts and gauge rules shared by the dash styles.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, k) => a + (b - a) * k;

// System fonts only. Apple devices have DIN and Avenir Next; Windows falls back
// to Bahnschrift / Arial Narrow, Android to Roboto Condensed.
export const FONTS = {
  cond: '"DIN Condensed", "Avenir Next Condensed", "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", "Roboto Condensed", sans-serif',
  din: '"DIN Alternate", Bahnschrift, "Avenir Next", Roboto, "Segoe UI", sans-serif',
  avenir: '"Avenir Next", Avenir, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  avenirCond: '"Avenir Next Condensed", "DIN Condensed", "Bahnschrift SemiCondensed", "Arial Narrow", "Roboto Condensed", sans-serif',
  mono: '"SF Mono", ui-monospace, Menlo, Consolas, "Roboto Mono", monospace',
  thin: '"Avenir Next", "Helvetica Neue", "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif',
};

export const font = (px, family, weight = 700, style = '') => `${style} ${weight} ${px}px ${family}`;

// Rpm scale: major step 1000 up to 10k, 2000 up to 20k, 5000 above.
// Redline starts at rpmMax − max(500, 10%), rounded to 250.
export function rpmScale(rpmMax) {
  const m = rpmMax > 0 ? rpmMax : 8000;
  const major = m <= 10000 ? 1000 : m <= 20000 ? 2000 : 5000;
  const max = Math.ceil((m + 250) / major) * major;
  const redline = Math.round((m - Math.max(500, m * 0.1)) / 250) * 250;
  return { rpmMax: m, max, major, minor: major / 2, redline };
}

// Shift lights start at 72% of rpmMax and are all lit at 96%.
export const shiftFraction = (ratio) => clamp((ratio - 0.72) / 0.24, 0, 1);

export const blink = (t, hz) => Math.floor(t * hz * 2) % 2 === 0;

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Annular sector path between radii r0 < r1 from angle a0 to a1.
export function sector(ctx, cx, cy, r0, r1, a0, a1) {
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
}

// Adds radial tick lines to the current path (caller strokes).
export function tickPath(ctx, cx, cy, r0, r1, a) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.moveTo(cx + c * r0, cy + s * r0);
  ctx.lineTo(cx + c * r1, cy + s * r1);
}

export function text(ctx, str, x, y, fnt, color, align = 'center', baseline = 'middle') {
  ctx.font = fnt;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

// Physical needle path: a tail behind the pivot, widest at the pivot, tapering
// to the tip. Lengths and widths are in virtual units; the caller fills.
export function needlePath(ctx, cx, cy, a, tail, tip, wTail, wHub, wTip) {
  const c = Math.cos(a), s = Math.sin(a);
  ctx.beginPath();
  ctx.moveTo(cx - c * tail - s * wTail, cy - s * tail + c * wTail);
  ctx.lineTo(cx - s * wHub, cy + c * wHub);
  ctx.lineTo(cx + c * tip - s * wTip, cy + s * tip + c * wTip);
  ctx.lineTo(cx + c * tip + s * wTip, cy + s * tip - c * wTip);
  ctx.lineTo(cx + s * wHub, cy - c * wHub);
  ctx.lineTo(cx - c * tail + s * wTail, cy - s * tail - c * wTail);
  ctx.closePath();
}

// G-meter dot offset (in g) for the force the driver feels: a right turn
// pushes the dot left, braking pushes it up. Clamped to maxG; reuses one array.
const gOut = [0, 0];
export function gFelt(gLat, gLon, maxG) {
  let x = -gLat, y = gLon;
  const m = Math.hypot(x, y);
  if (m > maxG) {
    x *= maxG / m;
    y *= maxG / m;
  }
  gOut[0] = x;
  gOut[1] = y;
  return gOut;
}

// Seven-segment display. Segments: a top, b upper right, c lower right,
// d bottom, e lower left, f upper left, g middle.
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', r: 'eg', R: 'eg', n: 'ceg', N: 'ceg',
};
const isPunct = (ch) => ch === ':' || ch === '.';

function hSeg(ctx, x0, x1, y, t, cy, k) {
  const h = t / 2;
  ctx.moveTo(x0 + (cy - y) * k, y);
  ctx.lineTo(x0 + h + (cy - y + h) * k, y - h);
  ctx.lineTo(x1 - h + (cy - y + h) * k, y - h);
  ctx.lineTo(x1 + (cy - y) * k, y);
  ctx.lineTo(x1 - h + (cy - y - h) * k, y + h);
  ctx.lineTo(x0 + h + (cy - y - h) * k, y + h);
  ctx.closePath();
}

function vSeg(ctx, x, y0, y1, t, cy, k) {
  const h = t / 2;
  ctx.moveTo(x + (cy - y0) * k, y0);
  ctx.lineTo(x + h + (cy - y0 - h) * k, y0 + h);
  ctx.lineTo(x + h + (cy - y1 + h) * k, y1 - h);
  ctx.lineTo(x + (cy - y1) * k, y1);
  ctx.lineTo(x - h + (cy - y1 + h) * k, y1 - h);
  ctx.lineTo(x - h + (cy - y0 - h) * k, y0 + h);
  ctx.closePath();
}

// Draws str in slanted seven-segment digits h tall, vertically centred on cy,
// with its right edge at x (align 'right'), left edge ('left') or centre.
// Supports 0-9, '-', r/R, n/N, ':' and '.'; anything else is a blank cell.
// Draw '8's in a dim colour first for the unlit segments.
export function sevenSeg(ctx, str, x, cy, h, color, align = 'right') {
  const w = h * 0.52, sp = h * 0.2, t = h * 0.13, gp = t * 0.22, k = 0.08, pw = h * 0.28;
  let total = -sp;
  for (let i = 0; i < str.length; i++) total += isPunct(str[i]) ? pw : w + sp;
  let left = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
  const top = cy - h / 2;
  const yT = top + t / 2, yB = top + h - t / 2;
  ctx.beginPath();
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (isPunct(ch)) {
      const px = left + (pw - t) / 2 - sp * 0.5;
      if (ch === ':') {
        ctx.rect(px + h * 0.22 * k, cy - h * 0.22 - t / 2, t, t);
        ctx.rect(px - h * 0.22 * k, cy + h * 0.22 - t / 2, t, t);
      } else {
        ctx.rect(px - (h / 2 - t / 2) * k, yB - t / 2, t, t);
      }
      left += pw;
      continue;
    }
    const seg = SEGMENTS[ch] || '';
    const xL = left + t / 2, xR = left + w - t / 2;
    for (let j = 0; j < seg.length; j++) {
      switch (seg[j]) {
        case 'a': hSeg(ctx, xL + gp, xR - gp, yT, t, cy, k); break;
        case 'b': vSeg(ctx, xR, yT + gp, cy - gp, t, cy, k); break;
        case 'c': vSeg(ctx, xR, cy + gp, yB - gp, t, cy, k); break;
        case 'd': hSeg(ctx, xL + gp, xR - gp, yB, t, cy, k); break;
        case 'e': vSeg(ctx, xL, cy + gp, yB - gp, t, cy, k); break;
        case 'f': vSeg(ctx, xL, yT + gp, cy - gp, t, cy, k); break;
        case 'g': hSeg(ctx, xL + gp, xR - gp, cy, t, cy, k); break;
      }
    }
    left += w + sp;
  }
  ctx.fillStyle = color;
  ctx.fill();
}

export function hbar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}

// Cached soft glow sprite (core + halo) so per-frame lights avoid shadowBlur.
const sprites = new Map();
export function glowSprite(color, r, core = 0.55) {
  const key = `${color}|${r}|${core}`;
  let c = sprites.get(key);
  if (c) return c;
  const res = 3; // oversample, the dash is scaled up to ~2x device pixels
  const size = Math.ceil(r * 4 * res);
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = size / 2;
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(core * 0.25, color);
  grad.addColorStop(0.5, color);
  grad.addColorStop(0.52, withAlpha(color, 0.45));
  grad.addColorStop(0.75, withAlpha(color, 0.12));
  grad.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  sprites.set(key, c);
  return c;
}

export function drawSprite(ctx, sprite, x, y, r) {
  ctx.drawImage(sprite, x - r * 2, y - r * 2, r * 4, r * 4);
}

// '#rrggbb' → 'rgba(r,g,b,a)'
export function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Remembers the last formatted value, so steady digits don't allocate strings.
export function memo(fn) {
  let lastIn = NaN, lastOut = '';
  return (x) => {
    if (x !== lastIn) {
      lastIn = x;
      lastOut = fn(x);
    }
    return lastOut;
  };
}

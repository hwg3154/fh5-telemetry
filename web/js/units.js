// Unit conversions and formatting. `metric` is a boolean everywhere.

export const G = 9.81;

export const speed = (ms, metric) => ms * (metric ? 3.6 : 2.23694);
export const speedUnit = (metric) => (metric ? 'km/h' : 'mph');

export const power = (w, metric) => (metric ? w / 1000 : w / 745.7);
export const powerUnit = (metric) => (metric ? 'kW' : 'hp');

export const torque = (nm, metric) => (metric ? nm : nm * 0.737562);
export const torqueUnit = (metric) => (metric ? 'Nm' : 'lb-ft');

export const boost = (psi, metric) => (metric ? psi * 0.0689476 : psi);
export const boostUnit = (metric) => (metric ? 'bar' : 'psi');

// Tire temperatures are believed to arrive in °F (verify in game).
export const temp = (f, metric) => (metric ? (f - 32) / 1.8 : f);
export const tempUnit = (metric) => (metric ? '°C' : '°F');

export const distance = (m, metric) => (metric ? m / 1000 : m / 1609.344);
export const distanceUnit = (metric) => (metric ? 'km' : 'mi');

export const length = (m, metric) => (metric ? m : m * 3.28084);
export const lengthUnit = (metric) => (metric ? 'm' : 'ft');

export const wheelRpm = (radPerSec) => (radPerSec * 60) / (2 * Math.PI);
export const deg = (rad) => (rad * 180) / Math.PI;

export function fixed(n, digits = 0) {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function signed(n, digits = 2) {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(digits);
  return n >= 0 ? `+${s}` : s;
}

export function lapTime(sec) {
  if (!(sec > 0)) return '-:--.---';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}

export function lapDelta(sec) {
  if (!Number.isFinite(sec)) return '';
  return `${sec >= 0 ? '+' : '−'}${Math.abs(sec).toFixed(3)}`;
}

// Tire temperature colour ramp in °F: 100 blue → 170 green → 210 yellow → 260+ red.
const TEMP_STOPS = [
  [100, 40, 110, 255],
  [170, 40, 210, 90],
  [210, 255, 210, 40],
  [260, 255, 45, 35],
];

export function tempColor(f, alpha = 1) {
  let r, g, b;
  if (!(f > TEMP_STOPS[0][0])) [, r, g, b] = TEMP_STOPS[0];
  else if (f >= TEMP_STOPS[3][0]) [, r, g, b] = TEMP_STOPS[3];
  else {
    let i = 0;
    while (f > TEMP_STOPS[i + 1][0]) i++;
    const a = TEMP_STOPS[i], c = TEMP_STOPS[i + 1];
    const k = (f - a[0]) / (c[0] - a[0]);
    r = a[1] + (c[1] - a[1]) * k;
    g = a[2] + (c[2] - a[2]) * k;
    b = a[3] + (c[3] - a[3]) * k;
  }
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

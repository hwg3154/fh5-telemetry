// Dash framework: canvas sizing and safe areas, the smoothed view model,
// cached static/glass layers and the style registry.

import porsche from './porsche.js';
import taycan from './taycan.js';
import boxster from './boxster.js';
import race from './race.js';
import ford from './ford.js';
import jdm from './jdm.js';
import { rpmScale, shiftFraction, clamp } from './common.js';
import * as U from '../units.js';
import { gearLabel, className, drivetrainName } from '../forza.js';

export const STYLES = [porsche, taycan, boxster, race, ford, jdm];
export const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

const VH = 900;
const MIN_W = 1280;
const MAX_W = 1950;
const MAX_DPR = 2;

// Self-test needle sweep when the dash first shows.
function sweepFraction(t) {
  if (t < 0.8) return 1 - (1 - t / 0.8) ** 3;
  if (t < 1.7) return 1 - ((t - 0.8) / 0.9) ** 2;
  return 0;
}

function createView() {
  return {
    t: 0, live: false, raceOn: false, metric: false, sweep: 0,
    rpmMax: 8000, scale: rpmScale(8000),
    rpm: 0, rpmRaw: 0, rpmFrac: 0, rpmRatio: 0, shift: 0, limiter: false,
    speed: 0, speedNeedle: 0, speedFrac: 0, speedMax: 200, speedUnit: 'mph',
    gear: 'N',
    throttle: 0, brake: 0, clutch: 0, handbrake: 0,
    boost: 0, boostNeedle: 0, boostFrac: 0, boostMin: -15, boostMax: 30, boostUnit: 'psi',
    fuel: 0, fuelNeedle: 0, fuelFrac: 0,
    power: 0, powerUnit: 'hp', torque: 0, torqueUnit: 'lb-ft',
    car: -1, powerW: 0, powerPeakW: 0, powerFrac: 0,
    tireTemp: [0, 0, 0, 0], tireTempF: [0, 0, 0, 0], tempUnit: '°F',
    slip: [0, 0, 0, 0],
    lap: 0, curLap: 0, lastLap: 0, bestLap: 0, position: 0,
    gLat: 0, gLon: 0, steer: 0,
    cls: '—', pi: 0, drivetrain: '—', classLine: '— · — · —',
    distance: 0, distanceUnit: 'mi',
  };
}

function updateView(v, state, dt, t) {
  const tel = state.t;
  const live = state.valid;
  const m = state.metric;
  const ease = (rate) => 1 - Math.exp(-rate * dt);

  v.t = t;
  v.live = live;
  v.raceOn = live && tel.isRaceOn !== 0;
  v.metric = m;

  // Keep the last known rpmMax while no data arrives.
  if (live && tel.engineMaxRpm > 500) v.rpmMax = tel.engineMaxRpm;
  if (v.scale.rpmMax !== v.rpmMax) v.scale = rpmScale(v.rpmMax);

  v.rpmRaw = live ? tel.rpm : 0;
  v.rpm += (v.rpmRaw - v.rpm) * ease(22);
  v.rpmRatio = v.rpmRaw / v.rpmMax;
  v.limiter = live && v.rpmRatio >= 0.96;
  v.shift = live ? shiftFraction(v.rpmRatio) : 0;

  v.speedUnit = U.speedUnit(m);
  v.speedMax = m ? 360 : 200;
  v.speed = live ? U.speed(tel.speed, m) : 0;
  v.speedNeedle += (v.speed - v.speedNeedle) * ease(14);

  v.gear = live && tel.hasDash ? gearLabel(tel.gear) : 'N';
  v.throttle += ((live ? tel.accel / 255 : 0) - v.throttle) * ease(25);
  v.brake += ((live ? tel.brake / 255 : 0) - v.brake) * ease(25);
  v.clutch = live ? tel.clutch / 255 : 0;
  v.handbrake = live ? tel.handbrake / 255 : 0;
  v.steer = live ? tel.steer / 127 : 0;

  v.boostUnit = U.boostUnit(m);
  v.boostMin = m ? -1 : -15;
  v.boostMax = m ? 2 : 30;
  v.boost = live ? U.boost(tel.boost, m) : 0;
  v.boostNeedle += (v.boost - v.boostNeedle) * ease(12);

  v.fuel = live ? tel.fuel : 0;
  v.fuelNeedle += (v.fuel - v.fuelNeedle) * ease(4);

  v.powerUnit = U.powerUnit(m);
  v.torqueUnit = U.torqueUnit(m);
  v.power = live ? U.power(tel.power, m) : 0;
  v.torque = live ? U.torque(tel.torque, m) : 0;

  // Power meter: fraction of the highest power seen for the current car
  // (at least 75 kW, so a gentle cruise doesn't read as full power).
  if (live && tel.carOrdinal !== v.car) {
    v.car = tel.carOrdinal;
    v.powerPeakW = 0;
  }
  const watts = live ? tel.power : 0;
  if (watts > v.powerPeakW) v.powerPeakW = watts;
  v.powerW += (watts - v.powerW) * ease(12);
  v.powerFrac = v.powerW / Math.max(v.powerPeakW, 75000);

  v.tempUnit = U.tempUnit(m);
  for (let i = 0; i < 4; i++) {
    v.tireTempF[i] = live ? tel.tireTemp[i] : 0;
    v.tireTemp[i] = live ? U.temp(tel.tireTemp[i], m) : 0;
    v.slip[i] = live ? tel.combinedSlip[i] : 0;
  }

  v.lap = live ? tel.lapNumber + 1 : 0;
  v.curLap = live ? tel.currentLap : 0;
  v.lastLap = live ? tel.lastLap : 0;
  v.bestLap = live ? tel.bestLap : 0;
  v.position = live ? tel.racePosition : 0;

  v.gLat += ((live ? tel.accelX / U.G : 0) - v.gLat) * ease(10);
  v.gLon += ((live ? tel.accelZ / U.G : 0) - v.gLon) * ease(10);

  if (live) {
    v.cls = className(tel.carClass);
    v.pi = tel.pi;
    v.drivetrain = drivetrainName(tel.drivetrain);
    v.classLine = `${v.cls} · ${v.pi} · ${v.drivetrain}`;
  }
  v.distanceUnit = U.distanceUnit(m);
  v.distance = live ? U.distance(tel.distance, m) : v.distance;

  const sw = sweepFraction(t);
  v.sweep = sw;
  v.rpmFrac = Math.max(v.rpm / v.scale.max, sw);
  v.speedFrac = clamp(Math.max(v.speedNeedle / v.speedMax, sw), 0, 1);
  v.boostFrac = clamp(Math.max((v.boostNeedle - v.boostMin) / (v.boostMax - v.boostMin), sw), 0, 1);
  v.fuelFrac = clamp(Math.max(v.fuelNeedle, sw), 0, 1);
  if (sw > 0) v.shift = Math.max(v.shift, sw);
}

export function createDash({ canvas, safe, state }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const staticLayer = document.createElement('canvas');
  const glassLayer = document.createElement('canvas');
  const sctx = staticLayer.getContext('2d');
  const gctx = glassLayer.getContext('2d');
  const v = createView();

  let geo = null;
  let style = null;
  let L = null;
  let cacheKey = '';
  let hasGlass = false;
  let dirty = true;
  let start = -1;
  let last = 0;

  const invalidate = () => { dirty = true; };
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', invalidate);

  // Virtual space: height 900, width clamp(aspect × 900, 1280, 1950), scaled to
  // fit the safe-area box. The background layer fills the whole screen.
  function measure() {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cs = getComputedStyle(safe);
    const it = parseFloat(cs.paddingTop) || 0;
    const ir = parseFloat(cs.paddingRight) || 0;
    const ib = parseFloat(cs.paddingBottom) || 0;
    const il = parseFloat(cs.paddingLeft) || 0;
    const cw = Math.max(1, cssW - il - ir);
    const ch = Math.max(1, cssH - it - ib);
    const W = Math.round(clamp((cw / ch) * VH, MIN_W, MAX_W));
    const scale = Math.min(cw / W, ch / VH);
    const ox = il + (cw - W * scale) / 2;
    const oy = it + (ch - VH * scale) / 2;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    for (const c of [canvas, staticLayer]) {
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
    }
    geo = { cssW, cssH, dpr, W, scale, ox, oy, pw, ph, k: dpr * scale };
    L = null;
    return true;
  }

  function setTransform(c) {
    c.setTransform(geo.k, 0, 0, geo.k, geo.dpr * geo.ox, geo.dpr * geo.oy);
  }

  function rebuild() {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.fillStyle = style.bg;
    sctx.fillRect(0, 0, geo.pw, geo.ph);
    setTransform(sctx);
    sctx.save();
    style.drawStatic(sctx, L, v);
    sctx.restore();

    hasGlass = typeof style.drawGlass === 'function';
    if (hasGlass) {
      if (glassLayer.width !== geo.pw) glassLayer.width = geo.pw;
      if (glassLayer.height !== geo.ph) glassLayer.height = geo.ph;
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.clearRect(0, 0, geo.pw, geo.ph);
      setTransform(gctx);
      gctx.save();
      style.drawGlass(gctx, L, v);
      gctx.restore();
    } else if (glassLayer.width) {
      glassLayer.width = glassLayer.height = 0;
    }
  }

  function frame(now) {
    if (dirty) {
      if (!measure()) return;
      dirty = false;
    }
    if (start < 0) start = last = now;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    updateView(v, state, dt, (now - start) / 1000);

    if (state.style !== style) {
      style = state.style;
      L = null;
    }
    if (!L) {
      L = style.layout(geo.W, VH);
      L.W = geo.W;
      L.H = VH;
      L.px = geo.k; // device pixels per virtual unit, for shadowBlur
      L.view = {
        x0: -geo.ox / geo.scale,
        y0: -geo.oy / geo.scale,
        x1: (geo.cssW - geo.ox) / geo.scale,
        y1: (geo.cssH - geo.oy) / geo.scale,
      };
      cacheKey = '';
    }

    const key = `${style.id}|${v.metric}|${v.scale.max}|${v.scale.redline}`;
    if (key !== cacheKey) {
      rebuild();
      cacheKey = key;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticLayer, 0, 0);
    setTransform(ctx);
    ctx.save();
    style.drawDynamic(ctx, L, v);
    ctx.restore();
    if (hasGlass) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(glassLayer, 0, 0);
    }
  }

  return { frame, invalidate };
}

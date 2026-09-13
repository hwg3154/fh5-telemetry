// Telemetry screen: panels built from a definition list. DOM text updates at
// ~15 Hz and only touches values that changed; charts redraw at ~30 Hz.

import * as U from '../units.js';
import { className, drivetrainName, gearLabel } from '../forza.js';
import { drawLines, drawGG, drawTrail } from './charts.js';

const DOM_INTERVAL_MS = 66;
const CHART_INTERVAL_MS = 33;
const WHEELS = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_COLORS = ['#ff9f0a', '#ffd60a', '#30d158', '#64d2ff'];

const fx = U.fixed;
const withUnit = (v, digits, unit) => `${fx(v, digits)} ${unit}`;
const pct = (frac) => `${fx(frac * 100, 0)} %`;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : Number.isNaN(x) ? 0 : x);

// ----------------------------------------------------------------- peaks --

export function createPeaks() {
  return { topSpeed: 0, maxPower: 0, maxBoost: 0, maxLatG: 0, maxAccelG: 0, maxBrakeG: 0, maxSlip: 0, maxTemp: 0 };
}

export function updatePeaks(p, t) {
  if (!t.isRaceOn) return;
  p.topSpeed = Math.max(p.topSpeed, t.speed);
  p.maxLatG = Math.max(p.maxLatG, Math.abs(t.accelX) / U.G);
  p.maxAccelG = Math.max(p.maxAccelG, t.accelZ / U.G);
  p.maxBrakeG = Math.max(p.maxBrakeG, -t.accelZ / U.G);
  for (let i = 0; i < 4; i++) p.maxSlip = Math.max(p.maxSlip, t.combinedSlip[i]);
  if (t.hasDash) {
    p.maxPower = Math.max(p.maxPower, t.power);
    p.maxBoost = Math.max(p.maxBoost, t.boost);
    for (let i = 0; i < 4; i++) p.maxTemp = Math.max(p.maxTemp, t.tireTemp[i]);
  }
}

// ----------------------------------------------------------- definitions --

function statusText(c) {
  const s = c.state;
  if (!s.wsOpen) return 'Disconnected';
  if (!s.live) return 'No data';
  if (s.badSize) return 'Unrecognized packet';
  return c.t.isRaceOn ? 'Live' : 'Paused / menus';
}

function hexBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (i && i % 4 === 0 ? ' ' : '') + bytes[i].toString(16).padStart(2, '0');
  return s;
}

const PANELS = [
  {
    title: 'Stream',
    rows: [
      ['Status', statusText],
      ['Format', (c) => (c.state.badSize ? `Unknown (${c.state.badSize} B)` : c.t.size ? `${c.t.format} (${c.t.size} B)` : '—')],
      ['Packets/s', (c) => (c.status ? String(c.status.pps) : '—')],
      ['Source', (c) => c.status?.from || '—'],
      ['Last packet', (c) => (!c.status ? '—' : c.status.lastPacketAgeMs < 0 ? 'never' : c.status.lastPacketAgeMs < 2000 ? `${c.status.lastPacketAgeMs} ms ago` : `${fx(c.status.lastPacketAgeMs / 1000, 0)} s ago`)],
      ['IsRaceOn', (c) => String(c.t.isRaceOn)],
      ['Game timestamp', (c) => `${c.t.timestampMs} ms`],
      ['Clients', (c) => (c.status ? String(c.status.clients) : '—')],
      ['UDP forwarding', (c) => (!c.status ? '—' : c.status.forwarding ? `${c.status.forwarding} target(s)` : 'off')],
    ],
  },
  {
    title: 'Car',
    rows: [
      ['CarOrdinal', (c) => String(c.t.carOrdinal)],
      ['Class', (c) => className(c.t.carClass)],
      ['PI', (c) => String(c.t.pi)],
      ['Drivetrain', (c) => drivetrainName(c.t.drivetrain)],
      ['Cylinders', (c) => String(c.t.cylinders)],
      { label: 'CarCategory? (232)', fn: (c) => String(c.t.carCategory), need: 'horizon' },
      { label: 'Byte 236 s32 / f32', fn: (c) => `${c.t.horizonInt[1]} / ${fx(c.t.horizonFloat[1], 3)}`, need: 'horizon' },
      { label: 'Byte 240 s32 / f32', fn: (c) => `${c.t.horizonInt[2]} / ${fx(c.t.horizonFloat[2], 3)}`, need: 'horizon' },
      { label: 'Bytes 232–243', fn: (c) => hexBytes(c.t.horizonRaw), need: 'horizon', mono: true },
      ['Dash style', (c) => c.state.style.name],
    ],
  },
  {
    title: 'Engine',
    rows: [
      { label: 'RPM', fn: (c) => fx(c.t.rpm, 0), bar: (c) => (c.t.engineMaxRpm > 0 ? c.t.rpm / c.t.engineMaxRpm : 0), big: true, color: '#ff6a3d' },
      ['Idle / max RPM', (c) => `${fx(c.t.engineIdleRpm, 0)} / ${fx(c.t.engineMaxRpm, 0)}`],
      { label: 'Power', fn: (c) => withUnit(U.power(c.t.power, c.m), 0, U.powerUnit(c.m)), need: 'dash' },
      { label: 'Torque', fn: (c) => withUnit(U.torque(c.t.torque, c.m), 0, U.torqueUnit(c.m)), need: 'dash' },
      { label: 'Boost', fn: (c) => withUnit(U.boost(c.t.boost, c.m), c.m ? 2 : 1, U.boostUnit(c.m)), need: 'dash' },
      { label: 'Fuel', fn: (c) => `${fx(c.t.fuel * 100, 1)} %`, bar: (c) => c.t.fuel, color: '#ffb000', need: 'dash' },
      { label: 'Gear', fn: (c) => `${gearLabel(c.t.gear)}  (raw ${c.t.gear})`, need: 'dash' },
    ],
  },
  {
    title: 'Speed & motion',
    rows: [
      { label: 'Speed', fn: (c) => withUnit(U.speed(c.t.speed, c.m), 1, U.speedUnit(c.m)), big: true },
      { label: 'Distance traveled', fn: (c) => withUnit(U.distance(c.t.distance, c.m), 2, U.distanceUnit(c.m)), need: 'dash' },
      ['Velocity X (right)', (c) => withUnit(U.speed(c.t.velX, c.m), 1, U.speedUnit(c.m))],
      ['Velocity Y (up)', (c) => withUnit(U.speed(c.t.velY, c.m), 1, U.speedUnit(c.m))],
      ['Velocity Z (forward)', (c) => withUnit(U.speed(c.t.velZ, c.m), 1, U.speedUnit(c.m))],
      ['Drift angle', (c) => (c.t.speed > 1 ? `${fx(U.deg(Math.atan2(c.t.velX, c.t.velZ)), 1)}°` : '—')],
    ],
  },
  {
    title: 'Acceleration',
    rows: [
      { label: 'Longitudinal', fn: (c) => `${U.signed(c.t.accelZ / U.G)} g`, two: (c) => c.t.accelZ / U.G / 2, color: '#ff6a3d' },
      { label: 'Lateral', fn: (c) => `${U.signed(c.t.accelX / U.G)} g`, two: (c) => c.t.accelX / U.G / 2, color: '#3d8bff' },
      { label: 'Vertical', fn: (c) => `${U.signed(c.t.accelY / U.G)} g`, two: (c) => c.t.accelY / U.G / 2, color: '#c9ccd3' },
      ['Total', (c) => `${fx(Math.hypot(c.t.accelX, c.t.accelY, c.t.accelZ) / U.G, 2)} g`],
    ],
  },
  {
    title: 'Rotation',
    rows: [
      ['Yaw', (c) => `${fx(U.deg(c.t.yaw), 1)}°`],
      ['Pitch', (c) => `${fx(U.deg(c.t.pitch), 1)}°`],
      ['Roll', (c) => `${fx(U.deg(c.t.roll), 1)}°`],
      ['Angular velocity X (pitch)', (c) => `${fx(U.deg(c.t.angVelX), 1)}°/s`],
      ['Angular velocity Y (yaw)', (c) => `${fx(U.deg(c.t.angVelY), 1)}°/s`],
      ['Angular velocity Z (roll)', (c) => `${fx(U.deg(c.t.angVelZ), 1)}°/s`],
    ],
  },
  {
    title: 'Inputs',
    need: 'dash',
    rows: [
      { label: 'Throttle', fn: (c) => pct(c.t.accel / 255), bar: (c) => c.t.accel / 255, color: 'var(--throttle)' },
      { label: 'Brake', fn: (c) => pct(c.t.brake / 255), bar: (c) => c.t.brake / 255, color: 'var(--brake)' },
      { label: 'Clutch', fn: (c) => pct(c.t.clutch / 255), bar: (c) => c.t.clutch / 255, color: '#c9ccd3' },
      { label: 'Handbrake', fn: (c) => pct(c.t.handbrake / 255), bar: (c) => c.t.handbrake / 255, color: '#ffb000' },
      { label: 'Steering', fn: (c) => `${U.signed((c.t.steer / 127) * 100, 0)} %`, two: (c) => c.t.steer / 127, color: 'var(--steer)' },
      { label: 'Driving line', fn: (c) => String(c.t.drivingLine), two: (c) => c.t.drivingLine / 127, color: '#8b8f99' },
      { label: 'AI brake difference', fn: (c) => String(c.t.aiBrakeDiff), two: (c) => c.t.aiBrakeDiff / 127, color: '#8b8f99' },
    ],
  },
  {
    title: 'Lap & race',
    need: 'dash',
    rows: [
      ['Lap', (c) => `${c.t.lapNumber + 1}  (raw ${c.t.lapNumber})`],
      ['Position', (c) => (c.t.racePosition ? String(c.t.racePosition) : '—')],
      { label: 'Current lap', fn: (c) => U.lapTime(c.t.currentLap), big: true },
      ['Last lap', (c) => U.lapTime(c.t.lastLap)],
      ['Best lap', (c) => U.lapTime(c.t.bestLap)],
      ['Last − best', (c) => (c.t.lastLap > 0 && c.t.bestLap > 0 ? U.lapDelta(c.t.lastLap - c.t.bestLap) : '—')],
      ['Race time', (c) => U.lapTime(c.t.raceTime)],
    ],
  },
  {
    title: 'Position',
    need: 'dash',
    rows: [
      ['World X', (c) => withUnit(U.length(c.t.posX, c.m), 1, U.lengthUnit(c.m))],
      ['World Y (altitude)', (c) => withUnit(U.length(c.t.posY, c.m), 1, U.lengthUnit(c.m))],
      ['World Z', (c) => withUnit(U.length(c.t.posZ, c.m), 1, U.lengthUnit(c.m))],
      { label: 'Track ordinal', fn: (c) => String(c.t.trackOrdinal), need: 'wear' },
    ],
  },
  {
    title: 'Session peaks',
    action: ['Reset', (state) => Object.assign(state.peaks, createPeaks())],
    rows: [
      ['Top speed', (c) => withUnit(U.speed(c.p.topSpeed, c.m), 1, U.speedUnit(c.m))],
      ['Max power', (c) => withUnit(U.power(c.p.maxPower, c.m), 0, U.powerUnit(c.m))],
      ['Max boost', (c) => withUnit(U.boost(c.p.maxBoost, c.m), c.m ? 2 : 1, U.boostUnit(c.m))],
      ['Max lateral g', (c) => `${fx(c.p.maxLatG, 2)} g`],
      ['Max acceleration g', (c) => `${fx(c.p.maxAccelG, 2)} g`],
      ['Max braking g', (c) => `${fx(c.p.maxBrakeG, 2)} g`],
      ['Max combined slip', (c) => fx(c.p.maxSlip, 2)],
      ['Max tire temp', (c) => withUnit(U.temp(c.p.maxTemp, c.m), 0, U.tempUnit(c.m))],
    ],
  },
  { title: 'Tires', wide: true, build: buildTires },
  {
    title: 'G-G diagram',
    chart: { square: true, draw: (cv, c) => drawGG(cv, c.hist) },
  },
  {
    title: 'Input trace',
    wide: true,
    chart: {
      legend: [['Throttle', 'var(--throttle)'], ['Brake', 'var(--brake)'], ['Steering (centred)', 'var(--steer)']],
      draw: (cv, c) => drawLines(cv, c.hist.time, [
        { ring: c.hist.throttle, color: '#34c759', min: 0, max: 1 },
        { ring: c.hist.brake, color: '#ff453a', min: 0, max: 1 },
        { ring: c.hist.steer, color: '#3d8bff', min: -1, max: 1 },
      ], { topLabel: '100%', bottomLabel: '0' }),
    },
  },
  {
    title: 'Speed / RPM trace',
    wide: true,
    chart: {
      legend: [['Speed', '#e9eaee'], ['RPM (fraction of max)', '#ff6a3d']],
      draw: (cv, c) => {
        const r = c.hist.speed;
        let top = 30;
        for (let i = 0; i < r.len; i++) top = Math.max(top, r.at(i));
        top = Math.ceil((top * 1.1) / 10) * 10;
        drawLines(cv, c.hist.time, [
          { ring: r, color: '#e9eaee', min: 0, max: top },
          { ring: c.hist.rpmFrac, color: '#ff6a3d', min: 0, max: 1 },
        ], { topLabel: fx(U.speed(top, c.m), 0), bottomLabel: '0' });
      },
    },
  },
  {
    title: 'Wheel slip trace',
    wide: true,
    chart: {
      legend: WHEELS.map((w, i) => [w, WHEEL_COLORS[i]]),
      draw: (cv, c) => drawLines(cv, c.hist.time, c.hist.slip.map((ring, i) => ({ ring, color: WHEEL_COLORS[i], min: 0, max: 3 })), {
        guides: [{ value: 1, label: '1.0', color: '#ff453a' }],
        topLabel: '3',
        bottomLabel: '0',
      }),
    },
  },
  {
    title: 'Suspension trace',
    wide: true,
    chart: {
      legend: WHEELS.map((w, i) => [w, WHEEL_COLORS[i]]),
      draw: (cv, c) => drawLines(cv, c.hist.time, c.hist.susp.map((ring, i) => ({ ring, color: WHEEL_COLORS[i], min: 0, max: 1 })), {
        topLabel: '1',
        bottomLabel: '0',
      }),
    },
  },
  {
    title: 'Position trail',
    need: 'dash',
    chart: { square: true, draw: (cv, c) => drawTrail(cv, c.hist, c.m) },
  },
];

function tireRows(i) {
  return [
    { label: 'Slip ratio', fn: (c) => U.signed(c.t.slipRatio[i]), two: (c) => c.t.slipRatio[i] / 2, color: '#ffb000' },
    { label: 'Slip angle', fn: (c) => U.signed(c.t.slipAngle[i]), two: (c) => c.t.slipAngle[i] / 2, color: '#3d8bff' },
    { label: 'Combined slip', fn: (c) => fx(c.t.combinedSlip[i], 2), bar: (c) => c.t.combinedSlip[i] / 2, color: '#ff453a' },
    { label: 'Suspension', fn: (c) => `${fx(c.t.suspMeters[i] * 1000, 0)} mm`, bar: (c) => c.t.suspNorm[i], color: '#c9ccd3' },
    { label: 'Wheel speed', fn: (c) => `${fx(c.t.wheelSpeed[i], 1)} rad/s` },
    { label: 'Wheel rpm', fn: (c) => fx(U.wheelRpm(c.t.wheelSpeed[i]), 0) },
    { label: 'Rumble strip', lamp: (c) => c.t.rumbleStrip[i] !== 0 },
    { label: 'Puddle depth', fn: (c) => fx(c.t.puddle[i], 2) },
    { label: 'Surface rumble', fn: (c) => fx(c.t.surfaceRumble[i], 3) },
    { label: 'Tire wear', fn: (c) => `${fx(c.t.tireWear[i] * 100, 1)} %`, bar: (c) => c.t.tireWear[i], color: '#ffb000', need: 'wear' },
  ];
}

// --------------------------------------------------------------- building --

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function normalizeRow(def) {
  return Array.isArray(def) ? { label: def[0], fn: def[1] } : def;
}

function buildRow(def, parent) {
  const el = h('div', 'row');
  el.append(h('span', 'label', def.label));
  const val = h('span', def.big ? 'value big' : 'value', def.lamp ? '' : '—');
  if (def.mono) val.style.fontFamily = 'ui-monospace, "SF Mono", Menlo, monospace';
  el.append(val);
  let fill = null;
  let lamp = null;
  if (def.bar || def.two) {
    const meter = h('div', def.two ? 'meter two' : 'meter');
    fill = h('i');
    if (def.color) fill.style.setProperty('--c', def.color);
    meter.append(fill);
    el.append(meter);
  }
  if (def.lamp) {
    lamp = h('i', 'lamp');
    val.append(lamp);
  }
  parent.append(el);
  return { def, el, val, fill, lamp, text: '', frac: NaN, on: false, hidden: false };
}

function updateRow(r, c) {
  const d = r.def;
  if (d.fn) {
    const s = d.fn(c);
    if (s !== r.text) {
      r.val.textContent = s;
      r.text = s;
    }
  }
  if (r.fill) {
    const f = d.bar ? clamp(d.bar(c), 0, 1) : clamp(d.two(c), -1, 1);
    if (!(Math.abs(f - r.frac) < 0.002)) {
      r.fill.style.transform = `scaleX(${f.toFixed(3)})`;
      r.frac = f;
    }
  }
  if (r.lamp) {
    const on = d.lamp(c);
    if (on !== r.on) {
      r.lamp.classList.toggle('on', on);
      r.on = on;
    }
  }
}

function buildTires(body, rows) {
  const grid = h('div', 'tires');
  const heads = WHEELS.map((name, i) => {
    const card = h('div', 'tire');
    const head = h('div', 'tire-head');
    const temp = h('span', '', '—');
    head.append(h('b', '', name), temp);
    card.append(head);
    for (const def of tireRows(i)) rows.push(buildRow(def, card));
    grid.append(card);
    return { head, temp, text: '', color: '' };
  });
  body.append(grid);

  return (c) => {
    heads.forEach((hd, i) => {
      const f = c.t.tireTemp[i];
      const s = c.t.hasDash ? `${fx(U.temp(f, c.m), 0)}${U.tempUnit(c.m)}` : '—';
      if (s !== hd.text) {
        hd.temp.textContent = s;
        hd.text = s;
        const color = c.t.hasDash ? U.tempColor(f) : '#333';
        if (color !== hd.color) {
          hd.head.style.backgroundColor = color;
          hd.color = color;
        }
      }
    });
  };
}

export function createTelemetryScreen({ root, state }) {
  const rows = [];
  const panels = [];
  const charts = [];
  const updaters = [];

  for (const def of PANELS) {
    const el = h('section', def.wide ? 'panel wide' : 'panel');
    const title = h('h2');
    title.append(h('span', '', def.title));
    if (def.action) {
      const btn = h('button', 'mini-btn', def.action[0]);
      btn.type = 'button';
      btn.addEventListener('click', () => def.action[1](state));
      title.append(btn);
    }
    el.append(title);
    panels.push({ el, need: def.need, hidden: false });

    if (def.rows) {
      for (const r of def.rows) {
        const row = buildRow(normalizeRow(r), el);
        rows.push(row);
      }
    }
    if (def.build) updaters.push(def.build(el, rows));
    if (def.chart) {
      const canvas = h('canvas', def.chart.square ? 'chart square' : 'chart');
      el.append(canvas);
      if (def.chart.legend) {
        const legend = h('div', 'legend');
        for (const [name, color] of def.chart.legend) {
          const item = h('span', '', name);
          item.style.setProperty('--c', color);
          legend.append(item);
        }
        el.append(legend);
      }
      charts.push({ canvas, draw: def.chart.draw, visible: true, key: '' });
    }
    root.append(el);
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const ch = charts.find((x) => x.canvas === e.target);
        if (ch) ch.visible = e.isIntersecting;
      }
    });
    for (const ch of charts) io.observe(ch.canvas);
  }

  const ctx = { state, t: state.t, hist: state.hist, p: state.peaks, m: false, status: null, live: false };
  let lastDom = -Infinity;
  let lastChart = -Infinity;

  function available(need) {
    const t = state.t;
    if (!need || !t.size) return true;
    if (need === 'dash') return t.hasDash;
    if (need === 'horizon') return t.hasHorizon;
    if (need === 'wear') return t.hasTireWear;
    return true;
  }

  function setHidden(item, hidden) {
    if (item.hidden !== hidden) {
      item.el.hidden = hidden;
      item.hidden = hidden;
    }
  }

  function frame(now) {
    ctx.m = state.metric;
    ctx.status = state.status;
    ctx.live = state.live;

    if (now - lastDom >= DOM_INTERVAL_MS) {
      lastDom = now;
      for (const p of panels) setHidden(p, !available(p.need));
      for (const r of rows) {
        const hidden = !available(r.def.need);
        setHidden(r, hidden);
        if (!hidden) updateRow(r, ctx);
      }
      for (const u of updaters) u(ctx);
    }

    if (now - lastChart >= CHART_INTERVAL_MS) {
      lastChart = now;
      for (const ch of charts) {
        if (!ch.visible) continue;
        // Skip redraws when nothing changed (no new packet, same size and units).
        const key = `${state.lastPacketAt}|${ch.canvas.clientWidth}|${ch.canvas.clientHeight}|${ctx.m}`;
        if (key === ch.key) continue;
        ch.key = key;
        ch.draw(ch.canvas, ctx);
      }
    }
  }

  return { frame };
}

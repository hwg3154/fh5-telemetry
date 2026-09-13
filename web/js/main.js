// Boot, routing, control bar, status banner, wake lock and settings.

import { createSocket } from './socket.js';
import { createTelemetry, parse } from './forza.js';
import { createHistory, recordHistory } from './history.js';
import { loadSettings, saveSettings, putCarStyle } from './settings.js';
import { createDash, STYLES, styleById } from './dash/index.js';
import { createTelemetryScreen, createPeaks, updatePeaks } from './telemetry/index.js';

const NO_DATA_MS = 2000;
const BAR_HIDE_MS = 4000;
const CONNECT_GRACE_MS = 1500;

const $ = (id) => document.getElementById(id);
const settings = loadSettings();

const state = {
  settings,
  t: createTelemetry(),
  hist: createHistory(),
  peaks: createPeaks(),
  status: null,       // last server status frame
  wsOpen: false,
  lastPacketAt: -Infinity,
  badSize: 0,         // size of the last packet if it was unrecognized
  live: false,        // packets are arriving
  valid: false,       // ...and they parse
  carStyles: {},      // CarOrdinal → style id, from the server
  style: styleById(settings.style),
  get metric() { return settings.units === 'metric'; },
};

const dash = createDash({ canvas: $('dash-canvas'), safe: $('safe'), state });
const telemetry = createTelemetryScreen({ root: $('panels'), state });

// ---------------------------------------------------------------- routing --

const bar = $('bar');
let route = '';
let barTimer = 0;

function setRoute(r) {
  if (r !== 'dash' && r !== 'telemetry') r = 'dash';
  if (location.hash !== `#${r}`) history.replaceState(null, '', `#${r}`);
  if (r === route) return;
  route = r;
  document.body.dataset.route = r;
  $('dash').hidden = r !== 'dash';
  $('telemetry').hidden = r !== 'telemetry';
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('active', a.dataset.route === r);
  settings.screen = r;
  saveSettings(settings);
  showBar();
}

// The bar auto-hides on the dash; tapping the dash brings it back.
function showBar() {
  bar.classList.remove('hide');
  clearTimeout(barTimer);
  if (route === 'dash') barTimer = setTimeout(() => bar.classList.add('hide'), BAR_HIDE_MS);
}

const syncBarHeight = () => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
new ResizeObserver(syncBarHeight).observe(bar);
syncBarHeight();

window.addEventListener('hashchange', () => setRoute(location.hash.slice(1)));
setRoute(location.hash.slice(1) || settings.screen);

$('dash').addEventListener('pointerdown', () => {
  showBar();
  requestWakeLock();
});
for (const type of ['pointerdown', 'change', 'focusin']) bar.addEventListener(type, showBar);

// iOS Safari ignores user-scalable=no; stop pinch-zoom on the dash.
document.addEventListener('gesturestart', (e) => {
  if (route === 'dash') e.preventDefault();
});

// ---------------------------------------------------------------- controls --

const select = $('style-select');
for (const s of STYLES) select.add(new Option(s.name, s.id));
select.value = state.style.id;

function applyStyle(style) {
  state.style = style;
  select.value = style.id;
}

select.addEventListener('change', () => {
  const style = styleById(select.value);
  applyStyle(style);
  settings.style = style.id;
  saveSettings(settings);
  const car = state.t.carOrdinal;
  if (state.valid && car > 0) {
    state.carStyles[car] = style.id;
    putCarStyle(car, style.id).catch((err) => console.warn('saving car style failed:', err));
  }
});

const unitsBtn = $('units-btn');
function renderUnits() {
  unitsBtn.textContent = state.metric ? 'Metric' : 'Imperial';
}
unitsBtn.addEventListener('click', () => {
  settings.units = state.metric ? 'imperial' : 'metric';
  saveSettings(settings);
  renderUnits();
});
renderUnits();

const fsBtn = $('fs-btn');
if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
  fsBtn.hidden = false;
  fsBtn.addEventListener('click', () => {
    const root = document.documentElement;
    const current = document.fullscreenElement || document.webkitFullscreenElement;
    const call = current
      ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
      : (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    Promise.resolve(call).catch(() => {});
  });
}

// ---------------------------------------------------------- car and style --

const carLabel = $('car-label');
let lastCar = -1;

function applyCarStyle() {
  const id = state.carStyles[lastCar];
  if (id && id !== state.style.id) applyStyle(styleById(id));
}

function onCarChange(car) {
  lastCar = car;
  carLabel.textContent = car > 0 ? `Car #${car}` : 'No car';
  applyCarStyle();
}

// ------------------------------------------------------------------ socket --

createSocket({
  onState(open) {
    state.wsOpen = open;
    if (!open) state.status = null;
  },
  onText(msg) {
    if (msg.type === 'status') {
      state.status = msg;
    } else if (msg.type === 'styles') {
      state.carStyles = msg.styles || {};
      applyCarStyle();
    }
  },
  onBinary(buf) {
    const now = performance.now();
    state.lastPacketAt = now;
    if (!parse(buf, state.t)) {
      state.badSize = buf.byteLength;
      return;
    }
    state.badSize = 0;
    recordHistory(state.hist, state.t, now);
    updatePeaks(state.peaks, state.t);
    if (state.t.carOrdinal !== lastCar) onCarChange(state.t.carOrdinal);
  },
});

// ------------------------------------------------------------------ banner --

const banner = $('banner');
const connDot = $('conn-dot');
let bannerKey = '';

function updateBanner(now) {
  state.live = state.wsOpen && now - state.lastPacketAt < NO_DATA_MS;
  state.valid = state.live && !state.badSize;

  let text = '';
  let kind = '';
  if (!state.wsOpen) {
    if (now > CONNECT_GRACE_MS) [kind, text] = ['error', 'Disconnected from server, reconnecting…'];
  } else if (!state.live) {
    [kind, text] = ['warn', `No telemetry: waiting for Forza Data Out on UDP ${state.status?.udpPort || 5300}`];
  } else if (state.badSize) {
    [kind, text] = ['warn', `Unrecognized packet: ${state.badSize} bytes`];
  } else if (!state.t.isRaceOn) {
    [kind, text] = ['info', 'Paused / in menus'];
  }

  const key = kind + text;
  if (key === bannerKey) return;
  bannerKey = key;
  banner.hidden = !text;
  banner.textContent = text;
  banner.className = kind;
  connDot.className = `dot ${state.valid ? 'ok' : state.wsOpen ? 'warn' : 'error'}`;
}

// --------------------------------------------------------------- wake lock --

let wakeLock = null;
let wakePending = false;

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || wakePending || document.visibilityState !== 'visible') return;
  wakePending = true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Not allowed (no HTTPS, low battery, no user gesture yet): fail silently.
  } finally {
    wakePending = false;
  }
}

document.addEventListener('visibilitychange', requestWakeLock);
requestWakeLock();

// -------------------------------------------------------------------- loop --

function frame(now) {
  requestAnimationFrame(frame);
  updateBanner(now);
  if (route === 'dash') dash.frame(now);
  else telemetry.frame(now);
}
requestAnimationFrame(frame);

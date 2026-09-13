// Per-device settings live in localStorage. The CarOrdinal → style map is
// shared by every device, so it lives on the server.

const KEY = 'fh5-telemetry:settings';
const DEFAULTS = { units: 'imperial', style: 'porsche', screen: 'dash' };

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private mode or storage blocked: settings just won't persist.
  }
}

export async function putCarStyle(car, style) {
  const res = await fetch(`api/styles/${encodeURIComponent(car)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ style }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

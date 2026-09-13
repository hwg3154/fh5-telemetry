// Ring buffers of recent telemetry. They fill on every packet whichever screen
// is showing, so charts already have history when you switch to them.

import { G } from './units.js';

export class Ring {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.cap = capacity;
    this.head = 0; // next write index
    this.len = 0;
  }

  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.cap;
    if (this.len < this.cap) this.len++;
  }

  // at(0) is the oldest sample, at(len - 1) the newest.
  at(i) {
    return this.buf[(this.head - this.len + i + this.cap) % this.cap];
  }

  last() {
    return this.len ? this.at(this.len - 1) : 0;
  }

  clear() {
    this.head = 0;
    this.len = 0;
  }
}

const SAMPLES = 1200;        // ~20 s at 60 Hz
const TRAIL_SAMPLES = 2400;  // 10 Hz for ~4 minutes
const TRAIL_INTERVAL_MS = 100;

export function createHistory() {
  const four = () => [0, 1, 2, 3].map(() => new Ring(SAMPLES));
  return {
    throttle: new Ring(SAMPLES),
    brake: new Ring(SAMPLES),
    steer: new Ring(SAMPLES),
    speed: new Ring(SAMPLES),   // m/s
    rpmFrac: new Ring(SAMPLES),
    gLat: new Ring(SAMPLES),
    gLon: new Ring(SAMPLES),
    slip: four(),
    susp: four(),
    trailX: new Ring(TRAIL_SAMPLES),
    trailZ: new Ring(TRAIL_SAMPLES),
    lastTrailAt: -Infinity,
  };
}

export function recordHistory(h, t, now) {
  h.throttle.push(t.accel / 255);
  h.brake.push(t.brake / 255);
  h.steer.push(t.steer / 127);
  h.speed.push(t.speed);
  h.rpmFrac.push(t.engineMaxRpm > 0 ? t.rpm / t.engineMaxRpm : 0);
  h.gLat.push(t.accelX / G);
  h.gLon.push(t.accelZ / G);
  for (let i = 0; i < 4; i++) {
    h.slip[i].push(t.combinedSlip[i]);
    h.susp[i].push(t.suspNorm[i]);
  }
  if (t.hasDash && now - h.lastTrailAt >= TRAIL_INTERVAL_MS) {
    h.lastTrailAt = now;
    h.trailX.push(t.posX);
    h.trailZ.push(t.posZ);
  }
}

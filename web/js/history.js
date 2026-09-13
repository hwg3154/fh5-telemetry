// Ring buffers of recent telemetry. They fill on every packet whichever screen
// is showing, so charts already have history when you switch to them.
//
// The game sends one packet per rendered frame (170/s on a 170 Hz monitor, 60/s
// at 60 fps), so samples are timestamped and capped at 60 Hz. Charts place
// points by time, so their time axis is right at any frame rate.

import { G } from './units.js';

export class Ring {
  constructor(capacity, Type = Float32Array) {
    this.buf = new Type(capacity);
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

export const HISTORY_MS = 20000;
const SAMPLE_MS = 1000 / 60;
const SAMPLES = Math.ceil(HISTORY_MS / SAMPLE_MS) + 60; // a little headroom for arrival jitter
const TRAIL_SAMPLES = 2400;  // 10 Hz for ~4 minutes
const TRAIL_INTERVAL_MS = 100;

export function createHistory() {
  const series = () => new Ring(SAMPLES);
  const four = () => [0, 1, 2, 3].map(series);
  return {
    time: new Ring(SAMPLES, Float64Array), // performance.now() of each sample; all series share its index
    throttle: series(),
    brake: series(),
    steer: series(),
    speed: series(),   // m/s
    rpmFrac: series(),
    gLat: series(),
    gLon: series(),
    slip: four(),
    susp: four(),
    slipHold: new Float32Array(4), // peak combined slip since the last sample
    nextSampleAt: -Infinity,
    trailX: new Ring(TRAIL_SAMPLES),
    trailZ: new Ring(TRAIL_SAMPLES),
    lastTrailAt: -Infinity,
  };
}

export function recordHistory(h, t, now) {
  // Hold slip peaks across skipped packets so short spikes still show.
  for (let i = 0; i < 4; i++) {
    if (t.combinedSlip[i] > h.slipHold[i]) h.slipHold[i] = t.combinedSlip[i];
  }

  if (now >= h.nextSampleAt) {
    // Steady 60 Hz cadence; after a gap, don't burst to catch up.
    h.nextSampleAt = Math.max(h.nextSampleAt + SAMPLE_MS, now + SAMPLE_MS / 2);
    h.time.push(now);
    h.throttle.push(t.accel / 255);
    h.brake.push(t.brake / 255);
    h.steer.push(t.steer / 127);
    h.speed.push(t.speed);
    h.rpmFrac.push(t.engineMaxRpm > 0 ? t.rpm / t.engineMaxRpm : 0);
    h.gLat.push(t.accelX / G);
    h.gLon.push(t.accelZ / G);
    for (let i = 0; i < 4; i++) {
      h.slip[i].push(h.slipHold[i]);
      h.slipHold[i] = 0;
      h.susp[i].push(t.suspNorm[i]);
    }
  }

  if (t.hasDash && now - h.lastTrailAt >= TRAIL_INTERVAL_MS) {
    h.lastTrailAt = now;
    h.trailX.push(t.posX);
    h.trailZ.push(t.posZ);
  }
}

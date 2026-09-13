// Forza "Data Out" packet layouts and parser. The layout is picked by packet
// length; everything is parsed into one reused object.

export const LAYOUTS = {
  324: { name: 'FH4 / FH5', dash: 244, horizon: true },
  331: { name: 'Forza Motorsport (2023)', dash: 232, tireWear: 311, track: 327 },
  311: { name: 'FM7 dash', dash: 232 },
  232: { name: 'FM7 sled', dash: -1 },
};

const quad = () => new Float32Array(4);

export function createTelemetry() {
  return {
    size: 0, format: '', hasDash: false, hasHorizon: false, hasTireWear: false,

    isRaceOn: 0, timestampMs: 0,
    engineMaxRpm: 0, engineIdleRpm: 0, rpm: 0,
    accelX: 0, accelY: 0, accelZ: 0,
    velX: 0, velY: 0, velZ: 0,
    angVelX: 0, angVelY: 0, angVelZ: 0,
    yaw: 0, pitch: 0, roll: 0,
    suspNorm: quad(), slipRatio: quad(), wheelSpeed: quad(),
    rumbleStrip: new Int32Array(4), puddle: quad(), surfaceRumble: quad(),
    slipAngle: quad(), combinedSlip: quad(), suspMeters: quad(),
    carOrdinal: 0, carClass: 0, pi: 0, drivetrain: 0, cylinders: 0,

    // Horizon-only bytes 232-243 (FH4 calls the first CarCategory; unverified for FH5)
    carCategory: 0, horizonRaw: new Uint8Array(12), horizonInt: new Int32Array(3), horizonFloat: new Float32Array(3),

    posX: 0, posY: 0, posZ: 0,
    speed: 0, power: 0, torque: 0,
    tireTemp: quad(),
    boost: 0, fuel: 0, distance: 0,
    bestLap: 0, lastLap: 0, currentLap: 0, raceTime: 0,
    lapNumber: 0, racePosition: 0,
    accel: 0, brake: 0, clutch: 0, handbrake: 0, gear: 0,
    steer: 0, drivingLine: 0, aiBrakeDiff: 0,

    tireWear: quad(), trackOrdinal: 0,
  };
}

function f4(dv, off, out) {
  for (let i = 0; i < 4; i++) out[i] = dv.getFloat32(off + i * 4, true);
}

// parse fills t from an ArrayBuffer. Returns false (t untouched) for an
// unrecognized packet size.
export function parse(buf, t) {
  const L = LAYOUTS[buf.byteLength];
  if (!L) return false;
  const dv = new DataView(buf);

  t.size = buf.byteLength;
  t.format = L.name;
  t.isRaceOn = dv.getInt32(0, true);
  t.timestampMs = dv.getUint32(4, true);
  t.engineMaxRpm = dv.getFloat32(8, true);
  t.engineIdleRpm = dv.getFloat32(12, true);
  t.rpm = dv.getFloat32(16, true);
  t.accelX = dv.getFloat32(20, true);
  t.accelY = dv.getFloat32(24, true);
  t.accelZ = dv.getFloat32(28, true);
  t.velX = dv.getFloat32(32, true);
  t.velY = dv.getFloat32(36, true);
  t.velZ = dv.getFloat32(40, true);
  t.angVelX = dv.getFloat32(44, true);
  t.angVelY = dv.getFloat32(48, true);
  t.angVelZ = dv.getFloat32(52, true);
  t.yaw = dv.getFloat32(56, true);
  t.pitch = dv.getFloat32(60, true);
  t.roll = dv.getFloat32(64, true);
  f4(dv, 68, t.suspNorm);
  f4(dv, 84, t.slipRatio);
  f4(dv, 100, t.wheelSpeed);
  for (let i = 0; i < 4; i++) t.rumbleStrip[i] = dv.getInt32(116 + i * 4, true);
  f4(dv, 132, t.puddle);
  f4(dv, 148, t.surfaceRumble);
  f4(dv, 164, t.slipAngle);
  f4(dv, 180, t.combinedSlip);
  f4(dv, 196, t.suspMeters);
  t.carOrdinal = dv.getInt32(212, true);
  t.carClass = dv.getInt32(216, true);
  t.pi = dv.getInt32(220, true);
  t.drivetrain = dv.getInt32(224, true);
  t.cylinders = dv.getInt32(228, true);

  t.hasHorizon = !!L.horizon;
  if (L.horizon) {
    for (let i = 0; i < 12; i++) t.horizonRaw[i] = dv.getUint8(232 + i);
    for (let i = 0; i < 3; i++) {
      t.horizonInt[i] = dv.getInt32(232 + i * 4, true);
      t.horizonFloat[i] = dv.getFloat32(232 + i * 4, true);
    }
    t.carCategory = t.horizonInt[0];
  }

  t.hasDash = L.dash >= 0;
  if (t.hasDash) {
    const d = L.dash;
    t.posX = dv.getFloat32(d, true);
    t.posY = dv.getFloat32(d + 4, true);
    t.posZ = dv.getFloat32(d + 8, true);
    t.speed = dv.getFloat32(d + 12, true);
    t.power = dv.getFloat32(d + 16, true);
    t.torque = dv.getFloat32(d + 20, true);
    f4(dv, d + 24, t.tireTemp);
    t.boost = dv.getFloat32(d + 40, true);
    t.fuel = dv.getFloat32(d + 44, true);
    t.distance = dv.getFloat32(d + 48, true);
    t.bestLap = dv.getFloat32(d + 52, true);
    t.lastLap = dv.getFloat32(d + 56, true);
    t.currentLap = dv.getFloat32(d + 60, true);
    t.raceTime = dv.getFloat32(d + 64, true);
    t.lapNumber = dv.getUint16(d + 68, true);
    t.racePosition = dv.getUint8(d + 70);
    t.accel = dv.getUint8(d + 71);
    t.brake = dv.getUint8(d + 72);
    t.clutch = dv.getUint8(d + 73);
    t.handbrake = dv.getUint8(d + 74);
    t.gear = dv.getUint8(d + 75);
    t.steer = dv.getInt8(d + 76);
    t.drivingLine = dv.getInt8(d + 77);
    t.aiBrakeDiff = dv.getInt8(d + 78);
  } else {
    // Sled-only formats: speed can still be derived from velocity.
    t.speed = Math.hypot(t.velX, t.velY, t.velZ);
  }

  t.hasTireWear = L.tireWear !== undefined;
  if (t.hasTireWear) {
    f4(dv, L.tireWear, t.tireWear);
    t.trackOrdinal = dv.getInt32(L.track, true);
  }
  return true;
}

export const CLASSES = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X'];
export const DRIVETRAINS = ['FWD', 'RWD', 'AWD'];

export const className = (c) => CLASSES[c] ?? `#${c}`;
export const drivetrainName = (d) => DRIVETRAINS[d] ?? `#${d}`;

// Believed encoding (verify in game): 0 = R, 1-10 = gears, 11 = N.
export function gearLabel(g) {
  if (g === 0) return 'R';
  if (g >= 11) return 'N';
  return String(g);
}

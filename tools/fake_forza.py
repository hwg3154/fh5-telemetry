#!/usr/bin/env python3
"""Synthetic Forza Horizon 5 "Data Out" sender for testing fh5-telemetry.

A car drives laps of a closed track: launch and shift up through six gears,
brake, corner, repeat. It simulates wheelspin, front lock-up, slip angle,
tire heating, load transfer, heading/position, laps and fuel burn.
Standard library only.

    python3 tools/fake_forza.py --host 127.0.0.1 --port 5300 --cars 3000,1234
"""
import argparse
import math
import random
import socket
import struct
import sys
import time

G = 9.81

# Little-endian layouts. Offsets are documented in DESIGN.md section 4.
SLED = struct.Struct('<iIfff' '3f3f3f3f' '4f4f4f' '4i' '4f4f4f4f4f' '5i')  # 232 bytes
HORIZON = struct.Struct('<iii')                                            # 12 bytes (232-243)
DASH = struct.Struct('<3f3f4f7fHBBBBBBbbb')                                # 79 bytes
assert SLED.size == 232 and HORIZON.size == 12 and DASH.size == 79

FORMATS = {
    'fh5': 324,      # sled + horizon bytes + dash + 1 pad
    'fm2023': 331,   # sled + dash + tire wear + track ordinal
    'fm7dash': 311,  # sled + dash
    'fm7sled': 232,  # sled only
    'bogus': 300,    # unrecognized size, to test the banner
}


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def approach(x, target, rate, dt):
    return x + (target - x) * min(1.0, rate * dt)


# ---------------------------------------------------------------- track ----

def build_track():
    """Closed track as (length_m, curvature) segments; curvature > 0 turns right.

    A rounded rectangle with four different right-hand corners and an S-bend.
    Straight lengths are chosen so the loop closes exactly.
    """
    q = math.pi / 2
    s = math.pi / 6
    r_s = 80.0
    segs = [
        (800.0, 0.0),
        (150.0 * q, 1 / 150.0),
        (350.0, 0.0),
        (70.0 * q, 1 / 70.0),
        (420.0, 0.0),
        (r_s * s, -1 / r_s), (r_s * 2 * s, 1 / r_s), (r_s * s, -1 / r_s),  # S-bend, 160 m forward
        (250.0, 0.0),
        (110.0 * q, 1 / 110.0),
        (400.0, 0.0),
        (60.0 * q, 1 / 60.0),
    ]
    out, start = [], 0.0
    for length, k in segs:
        out.append((start, length, k))
        start += length
    return out, start


def sample_track(track, total, step=1.0):
    """Precompute x, z, heading every `step` metres by exact arc integration."""
    pts = []
    x = z = h = 0.0
    for start, length, k in track:
        n = max(1, int(round(length / step)))
        ds = length / n
        for _ in range(n):
            pts.append((x, z, h))
            if k == 0.0:
                x += math.sin(h) * ds
                z += math.cos(h) * ds
            else:
                h2 = h + k * ds
                x += (math.cos(h) - math.cos(h2)) / k
                z += (math.sin(h2) - math.sin(h)) / k
                h = h2
    return pts


# ------------------------------------------------------------------ car ----

def car_profile(ordinal):
    rng = random.Random(ordinal)
    pi_ = rng.randint(620, 960)
    cls = 0 if pi_ <= 500 else 1 if pi_ <= 600 else 2 if pi_ <= 700 else 3 if pi_ <= 800 else 4 if pi_ <= 900 else 5 if pi_ <= 998 else 6
    return {
        'ordinal': ordinal,
        'max_rpm': float(rng.choice([7000, 7500, 8000, 8500, 9000])),
        'idle_rpm': float(rng.choice([800, 850, 900, 1000])),
        'torque': rng.uniform(420, 720),   # Nm peak
        'turbo_psi': rng.choice([0.0, 14.0, 20.0, 26.0]),
        'drivetrain': rng.choice([1, 1, 2, 0]),  # 0 FWD, 1 RWD, 2 AWD
        'cylinders': rng.choice([4, 6, 8, 10, 12]),
        'pi': pi_,
        'cls': cls,
        'category': rng.randint(10, 40),
        'mass': rng.uniform(1250, 1650),
        'ratios': [3.0, 2.1, 1.6, 1.28, 1.06, 0.9],
        'final': 3.9,
        'wheel_r': 0.34,
    }


class Sim:
    def __init__(self, cars, fuel, pause_every):
        self.cars = cars
        self.car_idx = 0
        self.car = car_profile(cars[0])
        self.pause_every = pause_every
        self.rng = random.Random(42)

        self.track, self.track_len = build_track()
        self.pts = sample_track(self.track, self.track_len)

        self.t = 0.0             # wall time since start
        self.race_t = 0.0
        self.s = 0.0             # distance along track, this lap
        self.distance = 0.0
        self.v = 0.0
        self.gear = 11           # neutral until launch
        self.rpm = self.car['idle_rpm']
        self.throttle = self.brake = self.clutch = self.handbrake = 0.0
        self.brake_spike = 0.0
        self.steer = 0.0
        self.shift_timer = 0.0
        self.limiter_timer = 0.0
        self.spool = 0.0
        self.boost = -8.0
        self.fuel = fuel
        self.long_g = self.lat_g = 0.0
        self.yaw_rate = 0.0
        self.slip_ratio = [0.0] * 4
        self.slip_angle = [0.0] * 4
        self.combined = [0.0] * 4
        self.wheel_speed = [0.0] * 4
        self.susp = [0.45] * 4
        self.tire_temp = [90.0] * 4
        self.rumble = [0] * 4
        self.puddle = [0.0] * 4
        self.surface = [0.0] * 4
        self.tire_wear = [0.0] * 4
        self.power = self.torque = 0.0
        self.lap = 0
        self.lap_t = 0.0
        self.last_lap = 0.0
        self.best_lap = 0.0
        self.position = 8
        self.paused_until = 0.0
        self.corner_pace = 0.97

    # -- helpers --
    def segment_at(self, s):
        for start, length, k in self.track:
            if s < start + length:
                return start, length, k
        return self.track[-1]

    def target_speed(self, k):
        if k == 0.0:
            return 1e9
        lat_cap = 1.05 * G
        return math.sqrt(lat_cap / abs(k)) * self.corner_pace

    def gear_ratio(self):
        if self.gear in (0, 11):
            return 0.0
        return self.car['ratios'][self.gear - 1] * self.car['final']

    def rpm_for(self, wheel_omega, gear):
        return wheel_omega * self.car['ratios'][gear - 1] * self.car['final'] * 60 / (2 * math.pi)

    def engine_torque(self, rpm):
        frac = clamp(rpm / self.car['max_rpm'], 0.0, 1.0)
        return self.car['torque'] * (0.55 + 0.45 * math.sin(math.pi * frac ** 0.9))

    # -- driver --
    def driver(self):
        """Throttle, brake and steer from braking points and corner speeds."""
        s = self.s
        start, length, k = self.segment_at(s)
        steer = clamp(self.v * self.v * k / G / 1.35, -1, 1)

        brake = 0.0
        want = 1.0
        # Look ahead up to 400 m for a corner we need to slow down for.
        decel = 1.25 * G
        for start2, length2, k2 in self.track + [(a + self.track_len, b, c) for a, b, c in self.track]:
            if start2 + length2 <= s or start2 > s + 400:
                continue
            vt = self.target_speed(k2)
            if vt >= self.v:
                continue
            dist = max(0.0, start2 - s)
            need = (self.v * self.v - vt * vt) / (2 * decel)
            if start2 <= s:            # already in the corner: hold speed
                want = min(want, clamp(0.45 + (vt - self.v) * 0.25, 0.0, 1.0))
            elif dist <= need * 1.05:
                brake = max(brake, clamp(0.6 + (need - dist) / 25, 0.0, 1.0))
                want = 0.0
        # Stamp on the brake at the start of each zone: brief front lock-up.
        if brake > 0 and self.brake < 0.05:
            self.brake_spike = 0.35
        if self.brake_spike > 0:
            brake = 1.0
        if k != 0.0 and s > start + length * 0.6:
            want = max(want, 0.8)       # power out of the corner
        if self.t < 1.5:                # sit in neutral before the launch
            want, brake = 0.0, 0.0
        return want, brake, steer

    # -- physics step --
    def step(self, dt):
        self.t += dt
        if self.t < self.paused_until:
            return
        car = self.car
        r = car['wheel_r']
        m = car['mass']

        self.brake_spike -= dt
        want_thr, want_brk, steer = self.driver()
        if self.gear == 11 and self.t >= 1.5:
            self.gear = 1
        if self.shift_timer > 0:
            self.shift_timer -= dt
            want_thr = 0.0
            self.clutch = 1.0
        else:
            self.clutch = approach(self.clutch, 0.0, 12, dt)
        self.throttle = approach(self.throttle, want_thr, 9, dt)
        self.brake = approach(self.brake, want_brk, 10, dt)
        self.steer = approach(self.steer, steer, 8, dt)

        # Engine and drive force
        wheel_omega = self.v / r
        if self.gear in (0, 11):
            target_rpm = car['idle_rpm'] + self.throttle * 0.6 * car['max_rpm']
        else:
            target_rpm = max(car['idle_rpm'], self.rpm_for(wheel_omega, self.gear))
            if self.gear == 1 and self.v < 10 and self.throttle > 0.3:
                target_rpm = max(target_rpm, 0.62 * car['max_rpm'])  # launch clutch slip

        self.spool = approach(self.spool, self.throttle * clamp(self.rpm / car['max_rpm'] * 1.6, 0, 1), 3, dt)
        if car['turbo_psi'] > 0:
            self.boost = -10.0 + self.spool * (car['turbo_psi'] + 10.0)
        else:
            self.boost = -10.0 + self.throttle * 10.0

        at_limiter = self.rpm >= car['max_rpm'] * 0.985
        eng_t = self.engine_torque(self.rpm) * (1 + max(0.0, self.boost) / 35)
        if at_limiter:
            eng_t *= 0.2
        eng_t_eff = eng_t * self.throttle - 0.07 * car['torque'] * (1 - self.throttle)
        ratio = self.gear_ratio()
        engaged = ratio > 0 and self.clutch < 0.5
        drive_f = eng_t_eff * ratio / r * 0.9 if engaged else 0.0

        # Longitudinal grip and wheel slip
        dt_type = car['drivetrain']
        rear_load = 0.5 + 0.08 * self.long_g
        front_load = 1.0 - rear_load
        driven_share = {0: front_load, 1: rear_load, 2: 1.0}[dt_type]
        grip_driven = 1.15 * m * G * driven_share * (1 + self.v / 250)
        spin = 0.0
        if drive_f > grip_driven:
            excess = drive_f / grip_driven - 1
            spin = min(4.0, 1.05 + excess * 2.5)
            drive_f = grip_driven * 0.92
        elif drive_f > 0:
            spin = 0.9 * drive_f / grip_driven

        brake_f = self.brake * 1.45 * m * G
        front_grip = 1.15 * m * G * (0.5 + 0.1 * max(0.0, -self.long_g))
        front_brake = brake_f * 0.66
        lock_f = 0.0
        if self.brake_spike > 0 and self.brake > 0.7:
            lock_f = -(1.2 + 0.8 * self.rng.random())
            brake_f *= 0.9
        elif front_brake > 0:
            lock_f = -min(0.95, 0.85 * front_brake / front_grip)
        lock_r = -0.6 * min(1.0, brake_f * 0.34 / (0.55 * m * G))

        drag = 0.5 * 1.2 * 0.72 * self.v * self.v + (150 if self.v > 0.1 else 0)
        scrub = abs(self.lat_g) * 1.2 * m
        accel = (drive_f - drag - scrub - (brake_f if self.v > 0.1 else 0)) / m
        accel = max(accel, -self.v / dt)
        self.v = max(0.0, self.v + accel * dt)

        # Shifting
        if self.gear not in (0, 11) and self.shift_timer <= 0:
            frac = self.rpm / car['max_rpm']
            self.limiter_timer = self.limiter_timer + dt if frac >= 0.96 else 0.0
            up_at = 0.35 if self.gear <= 2 else 0.0
            if self.gear < 6 and ((self.gear <= 2 and self.limiter_timer > up_at) or (self.gear > 2 and frac >= 0.93)):
                self.gear += 1
                self.shift_timer = 0.16
            elif self.gear > 1 and self.brake > 0.1 and frac < 0.5:
                self.gear -= 1
                self.shift_timer = 0.12
            elif self.gear > 1 and self.throttle > 0.5 and self.rpm_for(self.v / r, self.gear - 1) < car['max_rpm'] * 0.8 and frac < 0.45:
                self.gear -= 1
                self.shift_timer = 0.12

        # rpm follows the wheels, raised by wheelspin
        if self.gear not in (0, 11) and spin > 1 and dt_type != 0:
            target_rpm = max(target_rpm, target_rpm * (1 + 0.08 * spin))
        target_rpm = min(target_rpm, car['max_rpm'] * (0.99 + 0.012 * math.sin(self.t * 90)))
        self.rpm = approach(self.rpm, target_rpm, 14, dt)

        # Lateral
        _, _, k = self.segment_at(self.s)
        lat_demand = self.v * self.v * k / G
        lat_cap = 1.05 * (1 + self.v / 300)
        self.lat_g = approach(self.lat_g, clamp(lat_demand, -lat_cap, lat_cap), 10, dt)
        self.long_g = approach(self.long_g, accel / G, 12, dt)
        self.yaw_rate = self.v * k
        front_angle = abs(lat_demand) / 1.05
        rear_angle = abs(self.lat_g) / 1.05 * 0.85
        if dt_type != 0 and k != 0 and self.throttle > 0.6:
            rear_angle += 0.35 * self.throttle
        sgn = 1 if k >= 0 else -1
        self.slip_angle = [sgn * front_angle, sgn * front_angle * 0.97, sgn * rear_angle, sgn * rear_angle * 0.97]

        drive_front = spin if dt_type in (0, 2) else 0.05
        drive_rear = spin if dt_type in (1, 2) else 0.05
        if self.brake > 0.05:
            self.slip_ratio = [lock_f, lock_f * 0.96, lock_r, lock_r]
        else:
            self.slip_ratio = [drive_front, drive_front * 0.97, drive_rear, drive_rear * 1.02]
        self.combined = [math.hypot(a, b) for a, b in zip(self.slip_ratio, self.slip_angle)]
        base_omega = self.v / r
        self.wheel_speed = [max(0.0, base_omega * (1 + min(0.0, sr) * 0.9) + max(0.0, sr - 0.9) * 6) for sr in self.slip_ratio]

        # Track position, laps
        self.s += self.v * dt
        self.distance += self.v * dt
        if self.gear != 11:
            self.race_t += dt
            self.lap_t += dt
        if self.s >= self.track_len:
            self.s -= self.track_len
            self.finish_lap()

        # Tires: heat from slip and speed, cool towards rolling temperature
        for i in range(4):
            target = 125 + 35 * min(1.0, self.v / 60) + 90 * min(1.5, self.combined[i]) ** 1.5
            rate = 0.35 if target > self.tire_temp[i] else 0.1
            self.tire_temp[i] = approach(self.tire_temp[i], target, rate, dt)
            self.tire_wear[i] = min(1.0, self.tire_wear[i] + self.combined[i] * dt * 0.00004)

        # Surface: rumble strips at corner apexes (inside wheels), a puddle on the back straight
        start, length, k = self.segment_at(self.s)
        apex = k != 0 and abs((self.s - start) / length - 0.5) < 0.12
        inside = (1, 3) if k > 0 else (0, 2)
        self.rumble = [1 if apex and i in inside else 0 for i in range(4)]
        in_puddle = 420 < self.s < 470
        self.puddle = [approach(p, 0.45 if in_puddle else 0.0, 6, dt) for p in self.puddle]
        self.surface = [0.02 * self.rng.random() * min(1, self.v / 20) + (0.5 + 0.3 * self.rng.random() if self.rumble[i] else 0) for i in range(4)]

        # Suspension: base + load transfer + road noise
        for i in range(4):
            front = i < 2
            left = i % 2 == 0
            x = 0.45 + min(0.08, self.v * self.v / 60000)
            x += (-self.long_g if front else self.long_g) * 0.11
            x += (self.lat_g if left else -self.lat_g) * 0.12
            x += 0.015 * math.sin(self.t * (13 + i * 3.1)) + 0.01 * (self.rng.random() - 0.5)
            if self.rumble[i]:
                x += 0.06 * math.sin(self.t * 70)
            self.susp[i] = clamp(x, 0.0, 1.0)

        self.torque = eng_t_eff if self.gear != 11 else 0.0
        self.power = self.torque * self.rpm * 2 * math.pi / 60
        self.fuel = max(0.0, self.fuel - self.throttle * dt * 0.0006)
        if self.fuel < 0.02:
            self.fuel = 1.0

    def finish_lap(self):
        if self.lap_t > 5:
            self.last_lap = self.lap_t
            self.best_lap = self.lap_t if self.best_lap == 0 else min(self.best_lap, self.lap_t)
            print(f'lap {self.lap + 1}: {self.last_lap:.3f}s (best {self.best_lap:.3f}s) car #{self.car["ordinal"]}', flush=True)
        self.lap += 1
        self.lap_t = 0.0
        self.corner_pace = self.rng.uniform(0.94, 1.0)
        if self.rng.random() < 0.6:
            self.position = clamp(self.position + self.rng.choice([-1, -1, 1]), 1, 12)
        if len(self.cars) > 1:
            self.car_idx = (self.car_idx + 1) % len(self.cars)
            self.car = car_profile(self.cars[self.car_idx])
        if self.pause_every and self.lap % self.pause_every == 0:
            self.paused_until = self.t + 5.0

    # -- packet --
    def pack(self, fmt):
        size = FORMATS[fmt]
        car = self.car
        paused = self.t < self.paused_until
        x, z, heading = self.pts[int(self.s) % len(self.pts)]
        beta = -self.lat_g * 0.035
        vx, vz = self.v * math.sin(beta), self.v * math.cos(beta)
        gear = self.gear
        sled = SLED.pack(
            0 if paused else 1,
            int(self.t * 1000) & 0xFFFFFFFF,
            car['max_rpm'], car['idle_rpm'], self.rpm,
            self.lat_g * G, 0.15 * (self.rng.random() - 0.5), self.long_g * G,
            vx, 0.0, vz,
            -self.long_g * 0.05, self.yaw_rate, self.lat_g * 0.06,
            math.atan2(math.sin(heading), math.cos(heading)), self.long_g * 0.015, self.lat_g * 0.03,
            *self.susp, *self.slip_ratio, *self.wheel_speed,
            *self.rumble,
            *self.puddle, *self.surface, *self.slip_angle, *self.combined,
            *[0.02 + s * 0.1 for s in self.susp],
            car['ordinal'], car['cls'], car['pi'], car['drivetrain'], car['cylinders'],
        )
        if size == 232:
            return sled
        dash = DASH.pack(
            x, 12.0 + 2 * math.sin(self.s / 300), z,
            self.v, self.power, self.torque,
            *self.tire_temp,
            self.boost, self.fuel, self.distance, self.best_lap, self.last_lap, self.lap_t, self.race_t,
            self.lap, self.position,
            int(self.throttle * 255), int(self.brake * 255), int(self.clutch * 255), int(self.handbrake * 255),
            gear,
            int(clamp(self.steer, -1, 1) * 127), int(clamp(self.lat_g * 60, -127, 127)), 0,
        )
        if fmt == 'fh5':
            return sled + HORIZON.pack(car['category'], 0, 0) + dash + b'\x00'
        if fmt == 'fm2023':
            return sled + dash + struct.pack('<4fi', *self.tire_wear, 110)
        if fmt == 'fm7dash':
            return sled + dash
        return (sled + dash + bytes(size))[:size]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--host', default='127.0.0.1', help='server address (default 127.0.0.1)')
    ap.add_argument('--port', type=int, default=5300, help='UDP port (default 5300)')
    ap.add_argument('--hz', type=float, default=60.0, help='packets per second (default 60)')
    ap.add_argument('--cars', default='3000', help='comma-separated CarOrdinals; rotates every lap (default 3000)')
    ap.add_argument('--format', choices=sorted(FORMATS), default='fh5', help='packet layout (default fh5)')
    ap.add_argument('--fuel', type=float, default=1.0, help='starting fuel 0-1 (default 1.0)')
    ap.add_argument('--pause-every', type=int, default=0, metavar='LAPS', help='send IsRaceOn=0 for 5 s every N laps')
    ap.add_argument('--duration', type=float, default=0, help='stop after N seconds (default: run forever)')
    args = ap.parse_args()

    cars = [int(c) for c in args.cars.split(',') if c.strip()]
    sim = Sim(cars, clamp(args.fuel, 0, 1), args.pause_every)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    period = 1.0 / args.hz
    print(f'sending {args.format} ({FORMATS[args.format]} bytes) to {args.host}:{args.port} at {args.hz:g} Hz, '
          f'track {sim.track_len:.0f} m, cars {cars}', flush=True)

    next_t = time.perf_counter()
    end = next_t + args.duration if args.duration > 0 else None
    try:
        while end is None or time.perf_counter() < end:
            sim.step(period)
            sock.sendto(sim.pack(args.format), (args.host, args.port))
            next_t += period
            delay = next_t - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            elif delay < -0.5:
                next_t = time.perf_counter()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())

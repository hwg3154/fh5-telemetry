# FH5 Telemetry Dashboard: Design Doc

**Status:** Design agreed, no code written yet. The stack is proposed but not confirmed (see [Open questions](#10-open-questions)).
**Last updated:** 2026-09-12

---

## 1. Goal

A self-hosted web app that runs 24/7 in Docker on a home server. It receives **Forza Horizon 5 "Data Out"** telemetry and serves two screens:

1. **Dashboard:** a stylized gauge cluster. It runs on an iPad propped under the monitor for immersion.
2. **Telemetry:** a dense, detailed data screen with wheel slip, tire temps, suspension, g-forces, input traces, and more.

It must look good on a laptop, an iPad, and an iPhone.

---

## 2. Decisions made

| Topic | Decision |
|---|---|
| Games | **FH5 only** for now. **FH6** later, once its packet format is known. **Assetto Corsa is deferred**. It will come later through a helper program on the gaming PC. |
| Data retention | **Live only.** No logging, recording, or database. |
| Host | **x86-64 Ubuntu server VM**, running Docker. It shares the box with about 12 other services, so the app **must stay lightweight** in CPU, RAM, and image size. |
| Car → style mapping | **No lookup table.** A dropdown lets you pick the style manually. |
| Dashboard styles | **Modern Porsche**, **Race car** (Hoonicorn-style), **Modern Ford**, **JDM Analog** |
| Remote access / HTTPS | **Cloudflare Tunnel**, which provides HTTPS. |
| Auth | **No app login.** **Cloudflare Access** secures it. |
| Orientation | **Landscape only** for the dashboard. |
| No data arriving | Keep the dashboard visible and show a **warning banner**. |
| Telemetry screen | **Show as much data as possible.** Scrolling is fine. |
| Clients | Several devices can connect at once, e.g. the iPad on the dash and a laptop on telemetry. |
| Units | Imperial by default, with a toggle for metric. |

---

## 3. Proposed architecture

> **Needs confirmation.** The first planning pass suggested Node/TypeScript + React. Because of the "keep it lightweight" requirement, this doc proposes **Go server + vanilla JS client, no build step** instead.

```
 Gaming PC (FH5)                    Ubuntu VM (Docker)                        Clients
┌──────────────┐  UDP 60 Hz     ┌─────────────────────────────┐   WebSocket   ┌──────────────┐
│ Data Out     │  324-byte pkts │  fh5-telemetry (Go binary)  │   binary      │ iPad (dash)  │
│ → VM_IP:5300 │ ─────────────► │  UDP :5300 → relay → /ws    │ ────────────► │ Laptop       │
└──────────────┘   (LAN only)   │  HTTP :8080 static files    │  (LAN, or via │ iPhone       │
                                └─────────────────────────────┘   cloudflared)└──────────────┘
```

### 3.1 Server (Go)

- **Image and footprint:** a single static binary in a `FROM scratch` image, roughly 8 MB. Expected RAM use is around 10 MB.
- **Raw relay, no parsing:**
  - The UDP packet bytes go out unchanged as binary WebSocket frames to every connected client.
  - The server does almost no CPU work.
  - New formats (FH6, FM) only need client-side changes.
- **Packet filter:** accept packets of 232–4096 bytes and drop anything else. When no clients are connected, skip copying the packet.
- **Slow clients:**
  - Each client gets a buffered channel of 16 messages.
  - When a channel is full, frames for that client are dropped. A sleeping iPad never blocks anyone else.
  - Writes time out after 5 seconds.
- **Status frame:** a JSON text frame goes out every second:
  ```json
  {"type":"status","udpPort":5300,"pps":60,"lastPacketAgeMs":12,"lastSize":324,"from":"192.168.1.20","clients":2}
  ```
  This also stops Cloudflare's 100-second idle timeout from closing the WebSocket.
- **Static files:**
  - The web files are embedded in the binary with `//go:embed web`.
  - They are served with `Cache-Control: no-cache`, so Cloudflare's edge never serves stale JS or CSS after a redeploy.
- **Health checks:** a `GET /healthz` endpoint, plus a `healthcheck` subcommand for Docker's `HEALTHCHECK`. The scratch image has no curl, so the binary checks itself.
- **WebSocket library:** `github.com/coder/websocket`, with compression disabled.
  - Keep the default origin check. cloudflared keeps the original Host header, so the check passes through the tunnel.
- **Config:** env vars `HTTP_ADDR` (default `:8080`) and `UDP_ADDR` (default `:5300`).
- **Shutdown:** graceful on SIGTERM.
- **Bandwidth:** 324 B × 60/s ≈ **20 KB/s per client**.

### 3.2 Client (vanilla JS ES modules, no build step)

The gauges are drawn on a canvas every frame, so a framework adds nothing but a build step.

- **`socket.js`:**
  - Reconnects with exponential backoff, capped at 5 s.
  - A watchdog forces a reconnect if nothing arrives for 4 s. iOS leaves dead-but-"open" sockets after the app is backgrounded.
  - It also reconnects immediately on `visibilitychange`.
- **`forza.js`:** picks a layout by packet length and parses into one reused object, so nothing is allocated per packet.
- **Rendering:**
  - A single `requestAnimationFrame` loop draws **only the visible screen**.
  - **Dashboard:**
    - Static parts (faces, bezels, ticks, numerals, labels) are pre-drawn to an offscreen canvas.
    - That canvas is rebuilt only when the size, style, units, or rpm scale changes.
    - Each frame draws only the needles, bars, digits, and lights. An optional "glass" layer on top is also cached.
    - Device pixel ratio is capped at 2.
    - Needles move with exponential smoothing.
    - The needles sweep once when the page loads, like a real cluster's self-test.
  - **Telemetry:** DOM text updates at about 15 Hz and only touches values that changed. Canvas charts update at about 30 Hz.
- **Settings (localStorage, wrapped in try/catch):** units, current style, style-per-car map, last screen.

### 3.3 Dashboard scaling

- **Virtual coordinates:** height is fixed at **900**. Width is `clamp(aspect × 900, 1280, 1950)`.
- **Fit:** the virtual space is scaled to fit the safe-area content box. The background fills the whole screen.
- **Safe-area insets:** read from a hidden fixed element with `padding: env(safe-area-inset-*)`. This needs `viewport-fit=cover`.
- **Results on real screens:**
  - iPad 11" (1194×834) → W≈1288, fills the screen.
  - iPad 13" (1376×1032) → W=1280, small bars at top and bottom.
  - iPhone landscape (about 734×372 after safe areas) → W≈1776, fills the screen.
- **Styles lay out relative to `W`**, so they spread out on wide phones and tighten up on iPads.

---

## 4. FH5 Data Out packet format

**In game:** Settings → HUD and Gameplay:
- **Data Out** = On
- **Data Out IP Address** = the VM's LAN IP
- **Data Out IP Port** = 5300

The game sends about 60 packets per second and can send to **only one destination**.

The packet is **324 bytes, little-endian**:

- Bytes 0–231 match the FM7 "sled" section.
- Bytes 232–243 are extra Horizon-only bytes.
- Bytes 244–322 are the FM7 "dash" section, shifted by 12.
- Byte 323 is padding.

| Offset | Type | Field | Notes |
|---:|---|---|---|
| 0 | s32 | IsRaceOn | 1 = driving, 0 = menus/paused (packets still arrive) |
| 4 | u32 | TimestampMS | |
| 8 | f32 | EngineMaxRpm | |
| 12 | f32 | EngineIdleRpm | |
| 16 | f32 | CurrentEngineRpm | |
| 20 / 24 / 28 | f32 | AccelerationX / Y / Z | m/s², car-local: X right, Y up, Z forward |
| 32 / 36 / 40 | f32 | VelocityX / Y / Z | m/s, car-local |
| 44 / 48 / 52 | f32 | AngularVelocityX / Y / Z | rad/s (pitch / yaw / roll) |
| 56 / 60 / 64 | f32 | Yaw / Pitch / Roll | rad |
| 68–80 | f32 ×4 | NormalizedSuspensionTravel FL, FR, RL, RR | 0 = fully extended, 1 = fully compressed |
| 84–96 | f32 ×4 | TireSlipRatio | normalized; \|v\| > 1 ≈ grip lost |
| 100–112 | f32 ×4 | WheelRotationSpeed | rad/s |
| 116–128 | s32 ×4 | WheelOnRumbleStrip | 0/1 |
| 132–144 | f32 ×4 | WheelInPuddleDepth | 0–1 |
| 148–160 | f32 ×4 | SurfaceRumble | force-feedback value |
| 164–176 | f32 ×4 | TireSlipAngle | normalized; \|v\| > 1 ≈ grip lost (not radians) |
| 180–192 | f32 ×4 | TireCombinedSlip | normalized |
| 196–208 | f32 ×4 | SuspensionTravelMeters | m |
| 212 | s32 | CarOrdinal | numeric car ID (the car's name is **not** sent) |
| 216 | s32 | CarClass | Horizon: 0–6 = D, C, B, A, S1, S2, X |
| 220 | s32 | CarPerformanceIndex | |
| 224 | s32 | DrivetrainType | 0 FWD, 1 RWD, 2 AWD |
| 228 | s32 | NumCylinders | |
| 232 | s32 | *CarCategory?* | FH4 docs call this CarCategory. **Verify for FH5.** |
| 236–243 | — | *unknown* | Show raw values on the telemetry screen |
| 244 / 248 / 252 | f32 | PositionX / Y / Z | m, world space (Y = altitude) |
| 256 | f32 | Speed | m/s |
| 260 | f32 | Power | W (can be negative) |
| 264 | f32 | Torque | Nm |
| 268–280 | f32 ×4 | TireTemp FL, FR, RL, RR | **Believed °F. Verify.** |
| 284 | f32 | Boost | psi |
| 288 | f32 | Fuel | 0–1 |
| 292 | f32 | DistanceTraveled | m |
| 296 | f32 | BestLap | s |
| 300 | f32 | LastLap | s |
| 304 | f32 | CurrentLap | s |
| 308 | f32 | CurrentRaceTime | s |
| 312 | u16 | LapNumber | |
| 314 | u8 | RacePosition | |
| 315 | u8 | Accel | 0–255 |
| 316 | u8 | Brake | 0–255 |
| 317 | u8 | Clutch | 0–255 |
| 318 | u8 | HandBrake | 0–255 |
| 319 | u8 | Gear | **Believed 0 = R, 1–10 = gears, 11 = N. Verify.** |
| 320 | s8 | Steer | −127…127 |
| 321 | s8 | NormalizedDrivingLine | −127…127 |
| 322 | s8 | NormalizedAIBrakeDifference | −127…127 |
| 323 | — | padding | |

### 4.1 Other Forza formats (parser layout table, keyed by packet length)

| Size | Game | Dash section starts at | Extra |
|---:|---|---:|---|
| 324 | FH4 / FH5 | 244 | bytes 232–243 are Horizon-only |
| 331 | Forza Motorsport (2023) | 232 | +TireWear ×4 (f32) at 311, TrackOrdinal (s32) at 327 |
| 311 | FM7 dash | 232 | — |
| 232 | FM7 sled | — | no dash section |
| ? | **FH6** | ? | Capture a real packet when FH6 is out and add a layout entry. If it is still 324 bytes, it may just work. |

An unrecognized size shows a banner saying "Unrecognized packet: N bytes".

### 4.2 Derived values

| Value | Formula |
|---|---|
| g-force | `accel / 9.81`. Lateral = X, longitudinal = Z, vertical = Y. |
| Drift angle | `atan2(VelocityX, VelocityZ)` |
| Power | `hp = W / 745.7`, `kW = W / 1000` |
| Torque | `lb-ft = Nm × 0.737562` |
| Speed | `mph = m/s × 2.23694`, `km/h = m/s × 3.6` |
| Boost | `bar = psi × 0.0689476` |
| Temperature | `°C = (°F − 32) / 1.8` |
| Wheel RPM | `rad/s × 60 / 2π` |

### 4.3 Items to verify against the real game

- The packet size is 324.
- Tire temperature units.
- Gear encoding for reverse and neutral.
- What bytes 232–243 contain.
- IsRaceOn behavior while paused and in menus.

---

## 5. Common UI

- **Routing:** hash routes, `#dash` and `#telemetry`.
- **Control bar:**
  - Contains:
    - Dash | Telemetry tabs
    - **Style dropdown**
    - Units toggle
    - Fullscreen button, hidden where the Fullscreen API is unsupported (e.g. iPhone)
    - Current car number, e.g. "Car #3000"
  - On the dashboard it auto-hides after 4 s. Tap the dash to show it again.
  - On the telemetry screen it stays pinned at the top.
- **Per-car style memory (proposed, cheap):**
  - When you pick a style, it is saved against the current CarOrdinal.
  - When that car shows up again, its saved style is selected automatically.
  - This gives automatic switching by car without a lookup table.
  - It is stored per device in localStorage.
- **Status banner** (highest priority first):
  1. WebSocket down → "Disconnected from server, reconnecting…"
  2. No packets for more than 2 s → "No telemetry: waiting for Forza Data Out on UDP 5300"
  3. Unrecognized packet size → "Unrecognized packet: N bytes"
  4. IsRaceOn = 0 → a smaller "Paused / in menus" notice

  With no data, the dashboard stays visible and the needles drop to zero.
- **Rotate prompt:** shown on the dashboard when a touch device is in portrait (`@media (orientation: portrait) and (pointer: coarse)`). iOS Safari cannot lock orientation. The telemetry screen reflows and works in any orientation.
- **Screen Wake Lock:** available because Cloudflare serves the app over HTTPS.
  - Request it on load, on tap, and on `visibilitychange`.
  - Guard against requesting twice at once.
  - Fail silently. As a fallback, set Auto-Lock to Never or use Guided Access.
- **Home Screen web app:**
  - `manifest.webmanifest` with `display: fullscreen` and `orientation: landscape`.
  - `apple-mobile-web-app-capable` and `black-translucent` status bar meta tags.
  - Put `crossorigin="use-credentials"` on the manifest `<link>` so Cloudflare Access doesn't block the manifest request.
  - Home Screen web apps have their own cookie storage, so you may need to log in to Access again inside the installed app. If that causes trouble, use a normal Safari tab.
- **iOS touch behavior:** `touch-action: manipulation` and no overscroll on the dash, to prevent double-tap zoom and bounce.
- **Theme:** dark only.
- **Fonts:** system fonts only, no web font downloads.
  - Apple devices have DIN Condensed, DIN Alternate, Avenir Next, and Avenir Next Condensed.
  - Windows falls back to Bahnschrift and Arial Narrow; Android to Roboto Condensed.

---

## 6. Dashboard styles

### 6.1 Style module interface

```js
export default {
  id: 'porsche',
  name: 'Modern Porsche',
  bg: '#000',
  layout(W, H) { /* returns geometry L */ },
  drawStatic(ctx, L, v) { /* cached: faces, ticks, labels */ },
  drawDynamic(ctx, L, v) { /* every frame: needles, digits, bars */ },
  drawGlass(ctx, L, v) { /* optional cached overlay above needles */ },
};
```

**View model `v`** (built each frame from the telemetry, smoothed):
- rpm, rpmMax, rpmFrac, and the rpm scale
- speed and its unit
- gear label
- throttle, brake, clutch, handbrake
- boost and its unit
- fuel
- power and torque
- tire temps ×4 and combined slip ×4
- current, last, and best lap; lap number; position
- lateral and longitudinal g
- steering
- class, PI, drivetrain
- `live`, `raceOn`, `limiter`, and time `t` for blinking

### 6.2 Shared gauge rules

- **Rpm scale:**
  - `max = ceil((rpmMax + 250) / major) × major`
  - The major step is 1000 up to 10k, 2000 up to 20k (e.g. electric cars), and 5000 above that.
  - Minor step = major / 2.
  - Keep the last known rpmMax while no data arrives. Default to 8000.
- **Redline starts** at `rpmMax − max(500, 10% of rpmMax)`, rounded to 250.
- **Shift lights** start at 72% of rpmMax and are all lit at 96%. Above 96% they flash as the limiter warning.
- **Speedometer range** (analog styles): 0–200 mph or 0–360 km/h. The needle pins at the top.

### 6.3 Modern Porsche (992 / Taycan inspired)

- **Background:** black with a subtle vignette.
- **Center tachometer:**
  - Radius `min(390, 0.26W, 0.46H)`, sweeping 270° from 135° to 405° with the gap at the bottom.
  - Brushed-silver bezel ring.
  - White major and minor ticks with large white numerals.
  - Guards-red (`#d5001c`) redline band.
  - **Floating needle:** a tapered red-orange (`#ff3219`) segment from 0.52R to the outer edge, with a glow. There is no center hub, so the digits stay readable.
  - A faint translucent red sweep trails behind the needle.
- **Inside the tach:**
  - "RPM ×1000" label
  - Big digital speed with its unit
  - Gear in a rounded box
- **Below the tach:** thin throttle (white) and brake (red) bars, plus a class · PI · drivetrain line.
- **Left side panel** (dark rounded "screen"):
  - Boost mini arc gauge (240°) with the digital value
  - Power and torque readouts
  - Fuel bar that turns amber when low
- **Right side panel:**
  - Sport Chrono–style **G-force circle** with rings at 0.5, 1, and 1.5 g and a glowing dot
  - Lap block: lap number, current (large), last, best
- **Limiter:** the outer bezel ring flashes red at about 10 Hz above 96.5% of rpmMax.

### 6.4 Race car (Hoonicorn / MoTeC-style digital dash)

- **Background** `#050505`. Box borders `#2a2a2a`, amber labels (`#ffb000`), white values. DIN Condensed-style fonts.
- **Top:** a row of **15 shift LEDs** (5 green, 5 amber, 5 red) with halos drawn as radial gradients, not `shadowBlur`. At the limiter, **all LEDs flash blue** at about 8 Hz.
- **RPM bar graph:** full-width segments, one per 250 rpm.
  - White below 75%, amber up to the shift point, red above.
  - Numbers under every 1000 rpm.
- **Middle row:**
  - **Left column** (3 boxes): SPEED, BOOST, FUEL
  - **Center:** a huge gear digit, about 380 px tall. The box border flashes at the limiter.
  - **Right column** (3 boxes): CURRENT lap, LAST (with delta to best), BEST
- **Bottom row:** a 2×2 tire temperature grid with colored fills, throttle and brake vertical bars, lateral and longitudinal g, POS / LAP, and power.

### 6.5 Modern Ford (S650 Mustang digital cluster inspired)

- **Background:** a deep blue radial gradient (`#0b2140` fading to `#02050b`) with a faint blue horizon glow line.
- **Tachometer "tape":**
  - A wide, shallow arc across the top, 54 px thick, sweeping from 198° to 342°.
  - Radius `min(640, (W/2 − 70) / 0.951)`, with its center at `110 + R` so the top of the arc sits near y=110.
  - Dark segment background. Segments past the redline have a dark red tint.
- **Tape fill** (per frame, one stroke):
  - Stroke an arc up to the current rpm, using a horizontal gradient: Ford blue `#1f6fff` → cyan `#39c6ff` → orange `#ff8a00` → red.
  - Fake the glow with a second, wider stroke at 25% alpha instead of using `shadowBlur`.
  - Segment separator lines are drawn in the cached glass layer.
- **Numbers and ticks** sit outside the arc.
- **Center:** huge **italic** speed digits with the unit below. The gear sits to the right in a rounded box with a blue outline.
- **Bottom band:** 5 glassy cards with blue top borders:
  - BOOST (bar + value)
  - POWER
  - throttle and brake bars with class, PI, and drivetrain
  - LAP (current / best)
  - FUEL (bar + %)
- **Limiter:** the tape end pulses and a thin red outline appears.

### 6.6 JDM Analog (90s Supra / GT-R / RX-7 inspired)

- **Gauge sizes and positions:**
  - **Two large analog gauges:** tachometer on the left, speedometer on the right.
  - `R = clamp((W − 100) / 4.4, 250, 340)` and at most 0.38H. Centers are 2.15R apart, at cy ≈ 455.
  - **Two small gauges** (r = 0.33R) sit on the center line between the big ones, offset vertically by 0.85R so they clear the big bezels:
    - **BOOST** above
    - **FUEL** (E–F) below
- **Look:**
  - Matte dark cluster hood behind the gauges.
  - **Chrome bezels** drawn as diagonal gradient rings.
  - Black faces with a faint amber backlight halo.
  - Warm-white numerals and ticks; red redline ticks, numerals, and band.
- **Needles:**
  - Classic full pointers with a counterweight tail.
  - Orange (`#ff6a00`) with a glow. Only 2–4 needles use `shadowBlur`, which is acceptable.
  - Domed center caps.
- **Tachometer details:**
  - Sweeps 270°.
  - "×1000r/min" label.
  - An **amber LCD** shows the gear.
  - A red **SHIFT lamp** lights near the limiter.
- **Speedometer details:**
  - 0–200 mph (labels every 20) or 0–360 km/h (labels every 40).
  - An amber **ODO LCD** shows distance traveled.
- **Glass layer:** a subtle diagonal highlight clipped to each face, drawn above the needles.

---

## 7. Telemetry screen

- **Layout:**
  - A responsive grid (`repeat(auto-fill, minmax(300px, 1fr))`). Wide panels span 2 columns.
  - Scrolling is fine.
  - Built in JS from a panel definition list: `{ title, rows: [[label, (t, units) => string]] }`.

| Panel | Contents |
|---|---|
| **Stream** | status (live / no data / paused), format and size, packets/s (from server), source IP, IsRaceOn, game timestamp, connected clients |
| **Car** | CarOrdinal, class, PI, drivetrain, cylinders, category / raw bytes 232–243, active dash style |
| **Engine** | RPM with bar, idle and max RPM, power, torque, boost, fuel with bar, gear |
| **Speed & motion** | speed, distance traveled, car-local velocity X/Y/Z, drift angle |
| **Acceleration** | longitudinal, lateral, vertical, and total g |
| **Rotation** | yaw, pitch, roll (degrees); angular velocity X/Y/Z (deg/s) |
| **Inputs** | throttle, brake, clutch, handbrake bars with %; centered steering bar; driving line; AI brake difference |
| **Lap & race** | lap number, position, current / last / best lap, race time, last − best delta |
| **Position** | world X, Y (altitude), Z |
| **Session peaks** | top speed, max power, max boost, max lateral g, max acceleration g, max braking g, max combined slip, max tire temp. Includes a reset button. Stored in memory only. |
| **Tires** (wide) | 2×2 corner cards (FL FR / RL RR): temperature with color, slip ratio (two-sided bar), slip angle (two-sided bar), combined slip bar, suspension travel (normalized bar + mm), wheel speed (rad/s and rpm), rumble strip indicator, puddle depth, surface rumble. Tire wear appears only for FM formats that include it. |
| **G-G diagram** (canvas) | friction circle with rings at 0.5/1/1.5/2 g, the last 2 s as a trail, and the current dot |
| **Input trace** (wide canvas) | throttle (green), brake (red), steering (blue, centered) over the last 10–20 s |
| **Speed / RPM trace** (wide canvas) | speed and rpm fraction |
| **Wheel slip trace** (wide canvas) | combined slip per wheel (4 lines) with a guide line at 1.0 |
| **Suspension trace** (wide canvas) | normalized travel per wheel |
| **Position trail** (canvas) | top-down X/Z path, sampled at 10 Hz for about the last 4 minutes |

- **History buffers:** ring buffers (`Float32Array`) holding 1200 samples, about 20 s at 60 Hz. They fill on every packet whichever screen is showing, so charts already have history when you switch to them.
- **Tire temperature colors** (approximate, adjust after real data): 100°F blue → 170°F green → 210°F yellow → 260°F+ red.

---

## 8. Deployment

### 8.1 Proposed repo layout

```
fh5-telemetry/
├── main.go            # config, HTTP server, embed, healthcheck, shutdown
├── hub.go             # clients, broadcast, status ticker, /ws handler
├── udp.go             # UDP listener → hub
├── go.mod / go.sum    # one dependency: github.com/coder/websocket
├── web/
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── icon.svg
│   ├── css/app.css
│   └── js/
│       ├── main.js        # boot, routing, controls, banner, wake lock, settings
│       ├── socket.js      # WebSocket + reconnect + watchdog
│       ├── forza.js       # packet layouts + parser
│       ├── units.js       # conversions, formatting
│       ├── history.js     # ring buffers
│       ├── dash/
│       │   ├── index.js   # canvas sizing, view model, static/glass caching, style registry
│       │   ├── common.js  # drawing helpers, fonts, rpm scale
│       │   ├── porsche.js
│       │   ├── race.js
│       │   ├── ford.js
│       │   └── jdm.js
│       └── telemetry/
│           ├── index.js   # panel definitions, DOM updates
│           └── charts.js  # line charts, G-G, position trail
├── tools/
│   └── fake_forza.py  # synthetic FH5 packet sender (stdlib only)
├── Dockerfile
├── compose.yaml
├── .dockerignore
├── DESIGN.md
└── README.md
```

### 8.2 Dockerfile (sketch)

```dockerfile
FROM golang:1-alpine AS build          # pin a specific version when building
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/fh5-telemetry .

FROM scratch
COPY --from=build /out/fh5-telemetry /fh5-telemetry
USER 65534:65534
EXPOSE 8080/tcp 5300/udp
HEALTHCHECK --interval=30s --timeout=3s CMD ["/fh5-telemetry", "healthcheck"]
ENTRYPOINT ["/fh5-telemetry"]
```

### 8.3 compose.yaml (sketch)

```yaml
services:
  fh5-telemetry:
    build: .
    image: fh5-telemetry:latest
    container_name: fh5-telemetry
    restart: unless-stopped
    ports:
      - "${HTTP_PORT:-8080}:8080"   # web UI (point cloudflared here)
      - "${UDP_PORT:-5300}:5300/udp" # Forza Data Out
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 64m
    cpus: 0.5
    logging:
      driver: json-file
      options: { max-size: "1m", max-file: "2" }
```

### 8.4 Network and Cloudflare notes

- **UDP stays on the LAN.** FH5 sends straight to the VM's LAN IP; it does not go through the tunnel.
  - Give the VM a DHCP reservation or a static IP.
  - If ufw is enabled, open UDP 5300.
  - If the VM uses NAT networking in the hypervisor, forward UDP 5300 to it. Bridged networking is simpler.
- **Tunnel:** point the Cloudflare Tunnel's public hostname at `http://<host>:8080`, or at `http://fh5-telemetry:8080` if cloudflared runs on the same Docker network. Tunnels carry WebSockets without extra setup.
- **Access:** put a Cloudflare Access policy on the hostname. The WebSocket is on the same origin, so the Access cookie covers it.
- **Latency:**
  - Through the tunnel, the iPad's data goes out to the Cloudflare edge and back. That adds some latency that hasn't been measured yet.
  - If the needles feel laggy, compare against the LAN URL. The LAN URL has no HTTPS, so there's no Wake Lock and you'd need Auto-Lock set to Never.

---

## 9. Development & testing

- **`tools/fake_forza.py`:** a Python stdlib UDP sender that produces realistic synthetic 324-byte FH5 packets at 60 Hz.
  - **Driving loop:** accelerate and shift up through 6 gears → brake → corner left/right → repeat.
  - **Simulated data:**
    - Wheelspin at launch, front lock-up when braking, slip angle in corners
    - Tire heating and cooling
    - Suspension load transfer
    - Heading and position
    - Laps with last/best times, and fuel burn
  - **Flags:**
    - `--host` and `--port`
    - `--hz`
    - `--cars 3000,1234`: rotates the CarOrdinal to test per-car style memory
  - It runs anywhere: the server, a laptop, or the gaming PC.
- **Dev prerequisites:** Docker (or Go ≥ 1.22 to run it without a container) and Python 3.
- **Viewports to test:**
  - iPad 11" landscape (1194×834)
  - iPad 13" landscape (1376×1032)
  - iPhone landscape (852×393, with safe areas)
  - Laptop (1440×900)
- **Performance:** check that the dash holds 60 fps on the iPad, and that CPU and RAM stay low with `docker stats`.
- **Real game:** check the items in §4.3.

### Build order

1. Go relay, Dockerfile, compose, and `fake_forza.py`. Verify packets reach a browser.
2. `forza.js` parser, socket, status banner, control bar, settings.
3. Dashboard framework plus the **Race** style (simplest), then Porsche, Ford, and JDM.
4. Telemetry screen: panels, then charts.
5. Polish: Home Screen app, wake lock, safe areas, rotate prompt, testing on real devices.
6. README with setup steps: FH5 settings, compose, Cloudflare tunnel.

---

## 10. Open questions

1. **Confirm the stack:** Go server + vanilla JS (proposed, lightest), or Node/TypeScript + React (the earlier suggestion)?
2. **Does anything else need FH5's data?** SimHub, a motion rig, bass shakers? FH5 sends to only one destination, so the server would need to re-forward the raw UDP. It's cheap to add. *(Asked earlier, not yet answered.)*
3. **Per-car style memory:** per device in localStorage (proposed), or synced on the server (needs a small volume)?
4. **Units:** one Imperial/Metric toggle (proposed), or separate settings per unit?
5. **Speedometer range** for the analog styles: fixed 200 mph / 360 km/h (proposed), or something else?

## 11. Future work

- **FH6:** capture a packet, add a layout entry in `forza.js`, and verify the fields.
- **Assetto Corsa / ACC helper:**
  - A small Windows program on the gaming PC reads shared memory and sends a normalized packet to the server, using a different UDP port or a header magic number.
  - The client gets a matching parser.
  - Shared memory has much more data than FH5: tire pressures, core temps, brake temps, wear, TC/ABS, fuel, and the car model name.
  - The panels are already designed to show or hide based on what the current source provides.
- **Automatic style by manufacturer:** an optional CarOrdinal → manufacturer lookup table layered on top of the manual dropdown.

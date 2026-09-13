# FH5 Telemetry Dashboard

A lightweight self-hosted web app for **Forza Horizon 5 "Data Out"** telemetry:

- **Dash:** a canvas gauge cluster in four styles (Modern Porsche, Race car, Modern Ford, JDM Analog), built for an iPad propped under the monitor.
- **Telemetry:** a dense data screen with engine, inputs, laps, per-tire slip, temps and suspension, G-G diagram, traces and a position trail.

A single Go binary receives the UDP packets and relays them unchanged to browsers over a WebSocket. The client is plain ES modules with no build step. The image is about 11 MB and uses about 10 MB of RAM. See [DESIGN.md](DESIGN.md) for the full design.

## Quick start

```bash
docker compose up -d --build
```

Open `http://<server>:1234`. The page stays up and shows a "No telemetry" banner until the game sends data.

## Forza Horizon 5 settings

In **Settings → HUD and Gameplay**:

| Setting | Value |
|---|---|
| Data Out | On |
| Data Out IP Address | the server's LAN IP |
| Data Out IP Port | `5300` |

The game sends one packet per rendered frame (about 170 per second on a 170 Hz monitor) to **one** destination. To feed another tool as well (SimHub, a motion rig), set `FORWARD_ADDR` (below).

## Configuration

Compose variables (put them in a `.env` next to `compose.yaml` or export them):

| Variable | Default | Meaning |
|---|---|---|
| `HTTP_PORT` | `1234` | Host port for the web UI |
| `UDP_PORT` | `5300` | Host port for Forza Data Out |
| `FORWARD_ADDR` | *(empty)* | Comma-separated `host:port` list to re-send every raw packet to, e.g. `192.168.1.20:5301`. Hostnames are resolved at startup. |

Inside the container (or when running the binary directly):

| Variable | Default | Meaning |
|---|---|---|
| `HTTP_ADDR` | `:8080` | HTTP listen address |
| `UDP_ADDR` | `:5300` | UDP listen address |
| `DATA_DIR` | `data` (`/data` in the image) | Where `car-styles.json` is stored |
| `FORWARD_ADDR` | *(empty)* | As above |

The container runs read-only, as `nobody`, with all capabilities dropped, a 64 MB memory limit and half a CPU. The only writable path is the `fh5-data` volume, which holds the per-car style map.

## Network

- UDP stays on the LAN. The game sends straight to the server; it never goes through the tunnel.
- Give the server a DHCP reservation or a static IP.
- If ufw is enabled: `sudo ufw allow 5300/udp`.
- If the VM uses NAT networking in the hypervisor, forward UDP 5300 to it (bridged networking is simpler).

## Cloudflare Tunnel and Access

- Point the tunnel's public hostname at `http://127.0.0.1:1234` (cloudflared on the host network) or `http://<host>:1234`. WebSockets work through tunnels without extra settings.
- The app has **no login of its own**. Put a **Cloudflare Access** policy on the hostname. The WebSocket and API are same-origin, so the Access cookie covers them.
- HTTPS through the tunnel is what enables Screen Wake Lock on the iPad.
- **Add to Home Screen** on the iPad for a full-screen app. Home Screen apps have their own cookie jar, so you may need to log in to Access again inside it. If that's annoying, use a normal Safari tab.
- The tunnel adds a round trip to Cloudflare's edge. If the needles feel laggy, compare against the LAN URL (`http://<server>:1234`). It has no HTTPS, so there's no wake lock: set Auto-Lock to Never instead.

## Using it

- **Tap the dash** to show the control bar; it hides again after 4 seconds.
- **Style dropdown:** picking a style saves it for the current car (CarOrdinal) on the server. When that car shows up again, on any device, its style is selected automatically.
- **Units:** Imperial / Metric, per device.
- **Banners:** disconnected from server → no packets for 2 s → unrecognized packet size → paused / in menus.
- The dash is landscape-only; in portrait on a phone or tablet it asks you to rotate. The telemetry screen works in any orientation.

## Testing without the game

`tools/fake_forza.py` (Python 3, stdlib only) drives a car around a closed track and sends realistic packets: launch and shifts through six gears, braking with brief front lock-up, cornering, tire heating, load transfer, laps and fuel.

```bash
python3 tools/fake_forza.py --host 127.0.0.1 --port 5300
```

| Flag | Default | Purpose |
|---|---|---|
| `--host`, `--port` | `127.0.0.1`, `5300` | Where to send |
| `--hz` | `60` | Packet rate; the game sends one per frame, so try `170` to match a high-refresh monitor |
| `--cars 3000,1234` | `3000` | Rotate CarOrdinal every lap (tests per-car style memory) |
| `--format` | `fh5` | `fh5` (324 B), `fm2023` (331 B), `fm7dash` (311 B), `fm7sled` (232 B), `bogus` (300 B, tests the banner) |
| `--pause-every N` | off | Send IsRaceOn = 0 for 5 s every N laps |
| `--fuel` | `1.0` | Starting fuel (try `0.1` to see low-fuel colours) |
| `--duration` | forever | Stop after N seconds |

Stop the fake sender before you play: its packets would interleave with the game's.

## Development without Docker

Requires Go (see `go.mod`) and Python 3.

```bash
go run .
```

The web UI is then on `http://localhost:8080`. Web files are embedded at build time, so restart after editing them.

## HTTP endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | Web app (`Cache-Control: no-cache` with content-hash ETags) |
| `GET /ws` | WebSocket: binary frames are raw UDP packets; text frames are `status` (every second) and `styles` (on connect and on change) |
| `GET /healthz` | Health check (also `fh5-telemetry healthcheck` for Docker) |
| `GET /api/styles` | CarOrdinal → style map |
| `PUT /api/styles/{car}` | Body `{"style":"jdm"}`; an empty style removes the entry |

## To verify against the real game

Values the docs disagree on or that were never confirmed. The telemetry screen shows the raw values:

- Packet size is 324 bytes (Stream panel → Format).
- Tire temperature units (assumed °F).
- Gear encoding for reverse and neutral (Engine panel shows the raw gear).
- What bytes 232–243 contain (Car panel shows them as s32, f32 and hex).
- IsRaceOn behaviour while paused and in menus.

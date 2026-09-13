package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	clientBuffer = 16
	writeTimeout = 5 * time.Second
)

type frame struct {
	typ  websocket.MessageType
	data []byte
}

type client struct {
	send chan frame
}

// hub fans UDP packets and status frames out to WebSocket clients. Each client
// has a small buffered channel; when it is full, frames are dropped for that
// client only, so a sleeping iPad never holds anyone else up.
type hub struct {
	styles   *styleStore
	udpPort  int
	forwards int

	mu       sync.RWMutex
	clients  map[*client]struct{}
	nclients atomic.Int32

	statMu   sync.Mutex
	packets  int
	lastAt   time.Time
	lastSize int
	lastFrom netip.Addr
}

type statusMsg struct {
	Type            string `json:"type"`
	UDPPort         int    `json:"udpPort"`
	PPS             int    `json:"pps"`
	LastPacketAgeMs int64  `json:"lastPacketAgeMs"`
	LastSize        int    `json:"lastSize"`
	From            string `json:"from"`
	Clients         int    `json:"clients"`
	Forwarding      int    `json:"forwarding"`
}

type stylesMsg struct {
	Type   string            `json:"type"`
	Styles map[string]string `json:"styles"`
}

func newHub(styles *styleStore, udpPort, forwards int) *hub {
	return &hub{
		styles:   styles,
		udpPort:  udpPort,
		forwards: forwards,
		clients:  map[*client]struct{}{},
	}
}

func (h *hub) add(c *client) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = struct{}{}
	h.nclients.Store(int32(len(h.clients)))
	return len(h.clients)
}

func (h *hub) remove(c *client) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	h.nclients.Store(int32(len(h.clients)))
	return len(h.clients)
}

func (h *hub) broadcast(f frame) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.send <- f:
		default:
		}
	}
}

// packet records stats for one datagram and relays its bytes unchanged.
func (h *hub) packet(p []byte, from netip.Addr) {
	h.statMu.Lock()
	h.packets++
	h.lastAt = time.Now()
	h.lastSize = len(p)
	newSource := from != h.lastFrom
	h.lastFrom = from
	h.statMu.Unlock()
	if newSource {
		log.Printf("receiving telemetry from %s (%d bytes)", from, len(p))
	}

	if h.nclients.Load() == 0 {
		return
	}
	h.broadcast(frame{websocket.MessageBinary, bytes.Clone(p)})
}

// runStatus sends a JSON status frame every second. It doubles as a keepalive
// so Cloudflare's 100 s idle timeout never closes a socket while the game is off.
func (h *hub) runStatus(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	prev := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			h.statMu.Lock()
			st := statusMsg{
				Type:            "status",
				UDPPort:         h.udpPort,
				PPS:             int(math.Round(float64(h.packets) / now.Sub(prev).Seconds())),
				LastPacketAgeMs: -1,
				LastSize:        h.lastSize,
				Clients:         int(h.nclients.Load()),
				Forwarding:      h.forwards,
			}
			if !h.lastAt.IsZero() {
				st.LastPacketAgeMs = now.Sub(h.lastAt).Milliseconds()
			}
			if h.lastFrom.IsValid() {
				st.From = h.lastFrom.String()
			}
			h.packets = 0
			prev = now
			h.statMu.Unlock()

			if st.Clients == 0 {
				continue
			}
			b, err := json.Marshal(st)
			if err != nil {
				log.Printf("status: %v", err)
				continue
			}
			h.broadcast(frame{websocket.MessageText, b})
		}
	}
}

func (h *hub) stylesJSON() []byte {
	b, err := json.Marshal(stylesMsg{Type: "styles", Styles: h.styles.snapshot()})
	if err != nil {
		log.Printf("styles: %v", err)
		return []byte(`{"type":"styles","styles":{}}`)
	}
	return b
}

func (h *hub) serveWS(w http.ResponseWriter, r *http.Request) {
	// The default origin check stays on: cloudflared keeps the original Host
	// header, so same-origin pages pass through the tunnel.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		log.Printf("ws accept from %s: %v", remoteIP(r), err)
		return
	}
	defer conn.CloseNow()

	// Clients never send data. CloseRead answers control frames and cancels
	// ctx when the connection goes away.
	ctx := conn.CloseRead(r.Context())

	c := &client{send: make(chan frame, clientBuffer)}
	c.send <- frame{websocket.MessageText, h.stylesJSON()}
	log.Printf("client connected from %s (%d total)", remoteIP(r), h.add(c))
	defer func() { log.Printf("client disconnected from %s (%d total)", remoteIP(r), h.remove(c)) }()

	for {
		select {
		case <-ctx.Done():
			if r.Context().Err() != nil {
				conn.Close(websocket.StatusGoingAway, "server shutting down")
			}
			return
		case f := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Write(wctx, f.typ, f.data)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// waitClients gives WebSocket handlers a moment to send their close frames.
func (h *hub) waitClients(ctx context.Context) {
	for h.nclients.Load() > 0 && ctx.Err() == nil {
		time.Sleep(50 * time.Millisecond)
	}
}

func (h *hub) getStyles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(h.styles.snapshot())
}

// putStyle saves the dash style for one CarOrdinal and pushes the updated map
// to every client. An empty style removes the entry.
func (h *hub) putStyle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Style string `json:"style"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if err := h.styles.set(r.PathValue("car"), body.Style); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	h.broadcast(frame{websocket.MessageText, h.stylesJSON()})
	w.WriteHeader(http.StatusNoContent)
}

func remoteIP(r *http.Request) string {
	if ip := r.Header.Get("Cf-Connecting-Ip"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

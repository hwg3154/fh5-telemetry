// Command fh5-telemetry relays Forza "Data Out" UDP packets to browsers over
// WebSocket and serves the dashboard web app embedded in the binary.
package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	httpAddr := getenv("HTTP_ADDR", ":8080")
	udpAddr := getenv("UDP_ADDR", ":5300")

	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck(httpAddr))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	fwd, err := newForwarder(os.Getenv("FORWARD_ADDR"))
	if err != nil {
		log.Fatalf("FORWARD_ADDR: %v", err)
	}
	styles := loadStyles(getenv("DATA_DIR", "data"))
	h := newHub(styles, portOf(udpAddr), fwd.count())

	udp, err := listenUDP(udpAddr)
	if err != nil {
		log.Fatalf("udp listen %s: %v", udpAddr, err)
	}
	go runUDP(ctx, udp, h, fwd)
	go h.runStatus(ctx)

	mux := http.NewServeMux()
	mux.Handle("GET /", staticHandler())
	mux.HandleFunc("GET /ws", h.serveWS)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		fmt.Fprintln(w, "ok")
	})
	mux.HandleFunc("GET /api/styles", h.getStyles)
	mux.HandleFunc("PUT /api/styles/{car}", h.putStyle)

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// WebSocket handlers watch the request context, so cancelling ctx on
		// SIGTERM closes them (Shutdown does not touch hijacked connections).
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	ln, err := net.Listen("tcp", httpAddr)
	if err != nil {
		log.Fatalf("http listen %s: %v", httpAddr, err)
	}
	log.Printf("listening: http %s, udp %s", ln.Addr(), udp.LocalAddr())
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Print("shutting down")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
	h.waitClients(shutCtx)
}

// staticHandler serves the embedded web files with Cache-Control: no-cache and
// a content-hash ETag, so revalidation is a cheap 304 but a redeploy is never
// served stale (including from Cloudflare's edge).
func staticHandler() http.Handler {
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		panic(err)
	}
	etags := map[string]string{}
	err = fs.WalkDir(sub, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(sub, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		etags["/"+p] = `"` + hex.EncodeToString(sum[:8]) + `"`
		return nil
	})
	if err != nil {
		panic(err)
	}
	files := http.FileServerFS(sub)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean(r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/") {
			p = path.Join(p, "index.html")
		}
		if tag, ok := etags[p]; ok {
			w.Header().Set("ETag", tag)
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		files.ServeHTTP(w, r)
	})
}

// healthcheck is the Docker HEALTHCHECK command; the scratch image has no curl.
func healthcheck(httpAddr string) int {
	host, port, err := net.SplitHostPort(httpAddr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "status", resp.Status)
		return 1
	}
	return 0
}

func portOf(addr string) int {
	_, p, err := net.SplitHostPort(addr)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(p)
	return n
}

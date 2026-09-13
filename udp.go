package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/netip"
	"strings"
	"time"
)

const (
	minPacket = 232  // FM7 "sled", the smallest Forza format
	maxPacket = 4096 // anything bigger is not Forza
)

func listenUDP(addr string) (*net.UDPConn, error) {
	ua, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, err
	}
	return net.ListenUDP("udp", ua)
}

// runUDP reads datagrams until ctx is cancelled. Every packet goes to the
// forwarder; packets of a plausible Forza size also go to the hub.
func runUDP(ctx context.Context, conn *net.UDPConn, h *hub, fwd *forwarder) {
	go func() {
		<-ctx.Done()
		conn.Close()
	}()
	buf := make([]byte, maxPacket+1)
	for {
		n, from, err := conn.ReadFromUDPAddrPort(buf)
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Printf("udp read: %v", err)
			time.Sleep(100 * time.Millisecond)
			continue
		}
		if n > maxPacket {
			continue
		}
		fwd.send(buf[:n])
		if n < minPacket {
			continue
		}
		h.packet(buf[:n], from.Addr().Unmap())
	}
}

// forwarder re-sends raw packets to other listeners (SimHub, a motion rig...),
// because the game can only send Data Out to one destination. A nil
// forwarder is valid and does nothing.
type forwarder struct {
	conn *net.UDPConn
	dst  []netip.AddrPort
}

// newForwarder parses a comma-separated host:port list. Hostnames are resolved
// once at startup. An empty spec returns a nil forwarder.
func newForwarder(spec string) (*forwarder, error) {
	var dst []netip.AddrPort
	for _, s := range strings.Split(spec, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		ua, err := net.ResolveUDPAddr("udp", s)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", s, err)
		}
		dst = append(dst, ua.AddrPort())
	}
	if len(dst) == 0 {
		return nil, nil
	}
	conn, err := net.ListenUDP("udp", nil)
	if err != nil {
		return nil, err
	}
	log.Printf("forwarding raw UDP to %v", dst)
	return &forwarder{conn: conn, dst: dst}, nil
}

func (f *forwarder) count() int {
	if f == nil {
		return 0
	}
	return len(f.dst)
}

func (f *forwarder) send(p []byte) {
	if f == nil {
		return
	}
	for _, d := range f.dst {
		// Best effort, like the game itself: a missing listener is not an error.
		f.conn.WriteToUDPAddrPort(p, d)
	}
}

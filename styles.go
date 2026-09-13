package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sync"
)

const maxStyleEntries = 10000

var styleIDRe = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

// styleStore is the CarOrdinal → dash style map shared by all devices. It is
// kept in memory and written to DATA_DIR/car-styles.json on every change.
type styleStore struct {
	mu   sync.Mutex
	path string
	m    map[string]string
}

func loadStyles(dir string) *styleStore {
	s := &styleStore{path: filepath.Join(dir, "car-styles.json"), m: map[string]string{}}
	b, err := os.ReadFile(s.path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		log.Printf("styles: %v", err)
	default:
		if err := json.Unmarshal(b, &s.m); err != nil {
			log.Printf("styles: ignoring %s: %v", s.path, err)
			s.m = map[string]string{}
		}
	}
	log.Printf("styles: %d saved car styles (%s)", len(s.m), s.path)
	return s
}

func (s *styleStore) snapshot() map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return maps.Clone(s.m)
}

func (s *styleStore) set(car, style string) error {
	n, err := strconv.ParseInt(car, 10, 32)
	if err != nil || n < 0 {
		return errors.New("car must be a non-negative integer")
	}
	if style != "" && !styleIDRe.MatchString(style) {
		return errors.New("invalid style id")
	}
	car = strconv.FormatInt(n, 10)

	s.mu.Lock()
	defer s.mu.Unlock()
	if style == "" {
		delete(s.m, car)
	} else {
		if _, ok := s.m[car]; !ok && len(s.m) >= maxStyleEntries {
			return errors.New("too many saved cars")
		}
		s.m[car] = style
	}
	// A failed write keeps the change in memory; it is lost only on restart.
	if err := s.save(); err != nil {
		log.Printf("styles: save: %v", err)
	}
	return nil
}

func (s *styleStore) save() error {
	b, err := json.MarshalIndent(s.m, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

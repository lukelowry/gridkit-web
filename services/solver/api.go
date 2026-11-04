package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxReadBytes   = 8 << 20
	maxStreamBytes = 64 << 20
	maxStreamRows  = 65536
	maxSolverBytes = 1 << 20
	maxQueryBytes  = 16 << 20
)

// Failure is what a client is told: a code to act on and a message to show.
type Failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	status  int
}

func (f *Failure) Error() string { return f.Message }

func invalid(message string) *Failure { return &Failure{"invalid", message, http.StatusBadRequest} }
func internal(err error) *Failure {
	return &Failure{"simulation", err.Error(), http.StatusInternalServerError}
}

func reply(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, err error) {
	var failure *Failure
	switch {
	case errors.As(err, &failure):
		reply(w, failure.status, failure)
	case errors.Is(err, errExpired):
		reply(w, http.StatusGone, &Failure{Code: "expired", Message: "This simulation has expired."})
	default:
		log.Print(err)
		reply(w, http.StatusInternalServerError, &Failure{Code: "internal", Message: "The solver could not answer."})
	}
}

// Service owns the one run it retains. It reads neither models nor settings: GridKit judges those.
type Service struct {
	data, token string
	hosts       []string

	mu        sync.Mutex
	current   *Run
	uploading bool
}

// newService answers to `hosts` only, and requires `token` of every API request when it is set.
func newService(data, token string, hosts []string) (*Service, error) {
	if err := os.MkdirAll(data, 0o700); err != nil {
		return nil, err
	}
	// Runs do not outlive the process that owns them.
	entries, err := os.ReadDir(data)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			os.RemoveAll(filepath.Join(data, entry.Name()))
		}
	}
	return &Service{data: data, token: token, hosts: hosts}, nil
}

// stop ends a run still going, as the service shuts down.
func (s *Service) stop() {
	s.mu.Lock()
	run := s.current
	s.mu.Unlock()
	if run != nil {
		run.stop()
	}
}

// routes serves the API at this service's root, where an editor host mounts it as api/solver/. Only /health is open.
func (s *Service) routes() http.Handler {
	api := http.NewServeMux()
	route := func(pattern string, handler func(http.ResponseWriter, *http.Request) error) {
		api.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if err := handler(w, r); err != nil {
				fail(w, err)
			}
		})
	}
	present := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }
	// An editor host finds its solver by this answer at the root.
	api.HandleFunc("GET /{$}", present)
	route("POST /runs", s.begin)
	route("GET /runs/{id}", s.status)
	route("POST /runs/{id}/rows", s.rows)
	route("POST /runs/{id}/summary", s.summary)
	route("POST /runs/{id}/cancel", s.cancel)
	route("GET /runs/{id}/results", s.results)
	route("GET /runs/{id}/log", s.file("run.log", "text/plain"))
	route("GET /runs/{id}/solver", s.file("solver.json", "application/json"))
	root := http.NewServeMux()
	root.HandleFunc("GET /health", present)
	root.Handle("/", s.gate(api))
	return root
}

// gate admits requests that name a host this service answers to, carry its token, and come from its own origin.
func (s *Service) gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.allowed(r.Host) {
			fail(w, invalid("Invalid host."))
			return
		}
		if s.token != "" && subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.token)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			fail(w, &Failure{"authentication", "Solver authentication required.", http.StatusUnauthorized})
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			if parsed, err := url.Parse(origin); err != nil || parsed.Host != r.Host {
				fail(w, &Failure{"origin", "Use the editor origin for simulation requests.", http.StatusForbidden})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Service) allowed(host string) bool {
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
		if strings.Contains(host, ":") {
			host = "[" + host + "]"
		}
	}
	for _, allowed := range s.hosts {
		if strings.TrimSpace(allowed) == host {
			return true
		}
	}
	return false
}

func (s *Service) run(r *http.Request) (*Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current == nil || s.current.id != r.PathValue("id") {
		return nil, errExpired
	}
	return s.current, nil
}

// recording is a run and its store, once it has one.
func (s *Service) recording(r *http.Request) (*Run, *Store, error) {
	run, err := s.run(r)
	if err != nil {
		return nil, nil, err
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	if run.store == nil {
		return nil, nil, &Failure{"unavailable", "Nothing is recorded yet.", http.StatusConflict}
	}
	return run, run.store, nil
}

// begin takes a whole request in one body, multipart `solver` and `model`, streamed to disk as it arrives.
func (s *Service) begin(w http.ResponseWriter, r *http.Request) error {
	s.mu.Lock()
	if s.uploading || (s.current != nil && !s.current.ended()) {
		s.mu.Unlock()
		return &Failure{"busy", "A simulation is already active.", http.StatusConflict}
	}
	s.uploading = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.uploading = false
		s.mu.Unlock()
	}()

	name := make([]byte, 16)
	rand.Read(name)
	dir := filepath.Join(s.data, hex.EncodeToString(name))
	if err := os.Mkdir(dir, 0o700); err != nil {
		return err
	}
	solver, err := s.receive(r, dir)
	// An editor that left during its upload has nothing to follow this run with.
	if err == nil {
		err = r.Context().Err()
	}
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	// Only a good request retires the result before it.
	run := newRun(dir)
	s.mu.Lock()
	previous := s.current
	s.current = run
	s.mu.Unlock()
	if previous != nil {
		previous.retire()
	}
	run.start(solver)
	reply(w, http.StatusCreated, map[string]string{"id": run.id})
	return nil
}

func (s *Service) receive(r *http.Request, dir string) (string, error) {
	parts, err := r.MultipartReader()
	if err != nil {
		return "", invalid("Expected solver settings and a model.")
	}
	var settings map[string]any
	model, received := filepath.Join(dir, "model.json"), false
	for {
		part, err := parts.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", invalid(err.Error())
		}
		switch part.FormName() {
		case "solver":
			decoder := json.NewDecoder(io.LimitReader(part, maxSolverBytes))
			decoder.UseNumber() // Settings reach GridKit as written.
			if err := decoder.Decode(&settings); err != nil {
				return "", invalid("Expected a solver settings object.")
			}
		case "model":
			file, err := os.Create(model)
			if err != nil {
				return "", err
			}
			through := io.TeeReader(part, file)
			err = checkModel(through)
			if err == nil {
				_, err = io.Copy(io.Discard, through)
			}
			file.Close()
			if err != nil {
				return "", invalid("Invalid model: " + err.Error() + ".")
			}
			received = true
		}
	}
	if settings == nil || !received {
		return "", invalid("Expected solver settings and a model.")
	}
	text, err := solverSettings(settings, model)
	if err != nil {
		return "", err
	}
	solver := filepath.Join(dir, "solver.json")
	return solver, os.WriteFile(solver, text, 0o600)
}

// status holds until the run moves past `after`, for at most 20 s.
func (s *Service) status(w http.ResponseWriter, r *http.Request) error {
	run, err := s.run(r)
	if err != nil {
		return err
	}
	after := -1
	if text := r.URL.Query().Get("after"); text != "" {
		if after, err = strconv.Atoi(text); err != nil {
			return invalid("Expected an integer after.")
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	run.wait(ctx, after)
	status, err := run.status()
	if err != nil {
		return err
	}
	reply(w, http.StatusOK, status)
	return nil
}

func (s *Service) cancel(w http.ResponseWriter, r *http.Request) error {
	run, err := s.run(r)
	if err != nil {
		return err
	}
	if err := run.stop(); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func readQuery(w http.ResponseWriter, r *http.Request, query any) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxQueryBytes)).Decode(query); err != nil {
		return invalid("Expected a JSON query.")
	}
	return nil
}

func attach(w http.ResponseWriter, name, kind string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
}

func (s *Service) results(w http.ResponseWriter, r *http.Request) error {
	_, store, err := s.recording(r)
	if err != nil {
		return err
	}
	attach(w, "results.csv", "text/csv")
	return store.writeCSV(store.extent.Load(), func(text []byte) error {
		_, err := w.Write(text)
		return err
	})
}

func (s *Service) file(name, kind string) func(http.ResponseWriter, *http.Request) error {
	return func(w http.ResponseWriter, r *http.Request) error {
		run, err := s.run(r)
		if err != nil {
			return err
		}
		file, err := os.Open(filepath.Join(run.dir, name))
		if err != nil {
			return &Failure{"unavailable", "This download is not available.", http.StatusNotFound}
		}
		defer file.Close()
		attach(w, name, kind)
		http.ServeContent(w, r, name, time.Time{}, file)
		return nil
	}
}

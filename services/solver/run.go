package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// Status is what a run's address answers.
type Status struct {
	Sequence int         `json:"sequence"`
	State    string      `json:"state"`
	Rows     int         `json:"rows"`
	Range    *[2]float64 `json:"range"`
	Error    *Failure    `json:"error,omitempty"`
}

// Run is one simulation: a child process, what it has recorded, and who is waiting to hear.
type Run struct {
	id, dir string
	cancel  context.CancelFunc
	done    chan struct{}

	mu       sync.Mutex
	state    string
	sequence int
	failure  *Failure
	store    *Store
	expired  bool
	// Closed and replaced on every publication: every waiter wakes, and none holds a thread.
	changed chan struct{}
}

func newRun(dir string) *Run {
	return &Run{id: filepath.Base(dir), dir: dir, state: "running", sequence: 1, changed: make(chan struct{}), done: make(chan struct{})}
}

func terminal(state string) bool {
	return state == "completed" || state == "failed" || state == "cancelled"
}

func (r *Run) ended() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return terminal(r.state)
}

func (r *Run) publish(state string, failure *Failure) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if state != "" {
		r.state = state
	}
	r.failure = failure
	r.sequence++
	close(r.changed)
	r.changed = make(chan struct{})
}

// wait returns when the run has moved past `after`, has ended, or the context does.
func (r *Run) wait(ctx context.Context, after int) {
	for {
		r.mu.Lock()
		finished, changed := r.sequence > after || terminal(r.state) || r.expired, r.changed
		r.mu.Unlock()
		if finished {
			return
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return
		}
	}
}

// waitForRows returns when more than `rows` are committed, the run has ended, or the context does.
func (r *Run) waitForRows(ctx context.Context, rows int) {
	for {
		r.mu.Lock()
		finished, changed := terminal(r.state) || r.expired || (r.store != nil && r.store.extent.Load().rows > rows), r.changed
		r.mu.Unlock()
		if finished {
			return
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return
		}
	}
}

// current is the run's state, unless it has been replaced.
func (r *Run) current() (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.expired {
		return "", errExpired
	}
	return r.state, nil
}

func (r *Run) start(solver string) {
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	go func() {
		defer close(r.done)
		defer cancel()
		failure := r.simulate(ctx, solver)
		switch {
		case ctx.Err() != nil:
			r.publish("cancelled", nil)
		case failure != nil:
			r.publish("failed", failure)
		default:
			r.publish("completed", nil)
		}
	}()
}

func (r *Run) simulate(ctx context.Context, solver string) *Failure {
	logged, err := os.Create(filepath.Join(r.dir, "run.log"))
	if err != nil {
		return internal(err)
	}
	defer logged.Close()
	read, write, err := os.Pipe()
	if err != nil {
		return internal(err)
	}
	defer read.Close()
	process := exec.CommandContext(ctx, solverCommand, solver)
	process.Dir, process.Stdout, process.Stderr, process.ExtraFiles = r.dir, logged, logged, []*os.File{write}
	process.Cancel = func() error { return process.Process.Signal(syscall.SIGTERM) }
	process.WaitDelay = 3 * time.Second // Then it is killed.
	err = process.Start()
	write.Close()
	if err != nil {
		return internal(err)
	}

	var store *Store
	published := time.Now()
	recording := readRecording(read, func(columns []string) error {
		store = newStore(r.dir, columns)
		r.mu.Lock()
		r.store = store
		r.mu.Unlock()
		r.publish("", nil)
		return nil
	}, func(rows []float64) error {
		if err := store.Append(rows); err != nil {
			return err
		}
		if now := time.Now(); now.Sub(published) >= 50*time.Millisecond {
			published = now
			r.publish("", nil)
		}
		return nil
	})
	if recording != nil {
		process.Process.Kill()
	}
	exit := process.Wait()
	switch {
	case recording != nil:
		return &Failure{Code: "output", Message: recording.Error()}
	case exit != nil:
		return &Failure{Code: "simulation", Message: fmt.Sprintf("%s exited with code %d. Download the log for details.", solverCommand, process.ProcessState.ExitCode())}
	case store == nil || store.extent.Load().rows == 0:
		return &Failure{Code: "output", Message: solverCommand + " recorded no samples."}
	}
	return nil
}

func (r *Run) status() (Status, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.expired {
		return Status{}, errExpired
	}
	status := Status{Sequence: r.sequence, State: r.state, Error: r.failure}
	if r.store != nil {
		view := r.store.extent.Load()
		status.Rows, status.Range = view.rows, view.timeRange()
	}
	return status, nil
}

// stop ends a run and confirms it.
func (r *Run) stop() error {
	r.cancel()
	select {
	case <-r.done:
		return nil
	case <-time.After(10 * time.Second):
		return &Failure{"unavailable", "Could not confirm the simulation stopped.", 503}
	}
}

// retire expires a finished run and removes what it recorded.
func (r *Run) retire() {
	r.mu.Lock()
	r.expired = true
	store := r.store
	close(r.changed)
	r.changed = make(chan struct{})
	r.mu.Unlock()
	if store != nil {
		store.retire()
	}
	os.RemoveAll(r.dir)
}

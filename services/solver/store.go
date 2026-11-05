package main

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unsafe"
)

var errExpired = errors.New("this simulation has expired")

// Extent is one committed revision. Readers hold it; the writer publishes a new one after every file is written.
type Extent struct {
	rows       int
	start, end float64
	step       float64
	files      []*os.File
}

// timeRange is what the revision covers, once it holds a row.
func (e *Extent) timeRange() *[2]float64 {
	if e.rows == 0 {
		return nil
	}
	return &[2]float64{e.start, e.end}
}

// Store appends FP64 rows of [t, columns...] and folds every eight entries of a level into one min/max entry of the next.
type Store struct {
	dir     string
	columns []string
	index   map[string]int
	width   int
	// Each level's summary still gathering entries, and how many it holds.
	partials [][]float64
	held     []int
	files    []*os.File
	extent   atomic.Pointer[Extent]
	// Reads hold it to keep files open; retiring waits for them.
	open sync.RWMutex
	shut bool
}

func newStore(dir string, columns []string) *Store {
	store := &Store{dir: dir, columns: columns, width: len(columns), index: make(map[string]int, len(columns))}
	for i, name := range columns {
		store.index[name] = i
	}
	store.extent.Store(&Extent{})
	return store
}

// raw is the bytes of values, which are little-endian on the only platform GridKit's runtime supports.
func raw(values []float64) []byte {
	return unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(values))), len(values)*8)
}

func (s *Store) write(level int, values []float64) error {
	for len(s.files) <= level {
		name := "samples.bin"
		if len(s.files) > 0 {
			name = fmt.Sprintf("level-%d.bin", len(s.files))
		}
		file, err := os.OpenFile(filepath.Join(s.dir, name), os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		// Published extents keep the slice they saw.
		s.files = append(s.files[:len(s.files):len(s.files)], file)
	}
	_, err := s.files[level].Write(raw(values))
	return err
}

// Append commits whole rows. A reader sees them all, in every level, or none.
func (s *Store) Append(rows []float64) error {
	if len(rows) == 0 {
		return nil
	}
	stride, previous := s.width+1, s.extent.Load()
	next := Extent{rows: previous.rows + len(rows)/stride, start: previous.start, end: previous.end, step: previous.step}
	if previous.rows == 0 {
		next.start, next.end = rows[0], rows[0]
	}
	for i := 0; i < len(rows); i += stride {
		t := rows[i]
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return errors.New("the recording has an invalid time")
		}
		if t < next.end {
			return errors.New("the recording's times are not ordered")
		}
		next.step, next.end = max(next.step, t-next.end), t
	}
	if err := s.write(0, rows); err != nil {
		return err
	}
	// A row is its own summary: its time starts and ends it, and each value is its minimum and maximum.
	if err := s.fold(1, rows, stride, 0, 1, 1); err != nil {
		return err
	}
	next.files = s.files
	s.extent.Store(&next)
	return nil
}

// fold gathers the entries of the level below, `stride` apart in `from`, eight to each summary of `level`, and writes the
// summaries it finishes. An entry starts at its first value, ends at `end`, and holds its minima from `low` and maxima from
// `high`. A NaN stays in its bucket: a gap is never bridged at a coarse level.
func (s *Store) fold(level int, from []float64, stride, end, low, high int) error {
	for len(s.held) <= level {
		s.partials, s.held = append(s.partials, nil), append(s.held, 0)
	}
	size, width, carried := 2+2*s.width, s.width, s.held[level]
	total := carried + len(from)/stride
	// The summaries gather in place, the one carried from the last fold first.
	out := make([]float64, (total+7)/8*size)
	copy(out, s.partials[level])
	for k, at := carried, 0; at < len(from); k, at = k+1, at+stride {
		slot, entry := out[k/8*size:][:size], from[at:][:stride]
		lows, highs, mins, maxs := entry[low:][:width], entry[high:][:width], slot[2:][:width], slot[2+width:]
		if k%8 == 0 {
			slot[0] = entry[0]
			copy(mins, lows)
			copy(maxs, highs)
		} else {
			for c, value := range lows {
				if value < mins[c] || value != value {
					mins[c] = value
				}
			}
			for c, value := range highs {
				if value > maxs[c] || value != value {
					maxs[c] = value
				}
			}
		}
		slot[1] = entry[end]
	}
	whole := total / 8
	s.held[level], s.partials[level] = total%8, append(s.partials[level][:0], out[whole*size:]...)
	if whole == 0 {
		return nil
	}
	summaries := out[:whole*size]
	if err := s.write(level, summaries); err != nil {
		return err
	}
	return s.fold(level+1, summaries, size, 1, 2, 2+width)
}

// retire waits out reads in progress and closes the files.
func (s *Store) retire() {
	s.open.Lock()
	defer s.open.Unlock()
	s.shut = true
	for _, file := range s.files {
		file.Close()
	}
}

// selection finds unique, known columns.
func (s *Store) selection(names []string) ([]int, error) {
	columns, seen := make([]int, len(names)), make(map[string]bool, len(names))
	for i, name := range names {
		column, known := s.index[name]
		if !known {
			return nil, invalid("This run did not record " + name + ".")
		}
		if seen[name] {
			return nil, invalid("Choose each column once: " + name + ".")
		}
		seen[name] = true
		columns[i] = column
	}
	return columns, nil
}

// planes reads `rows` entries of one level from `first`: times then values at level 0, starts, ends, minima and maxima above it.
func (s *Store) planes(view *Extent, level, first, rows int, columns []int) ([]float64, error) {
	s.open.RLock()
	defer s.open.RUnlock()
	if s.shut {
		return nil, errExpired
	}
	stride, times := s.width+1, 1
	if level > 0 {
		stride, times = 2+2*s.width, 2
	}
	c := len(columns)
	out := make([]float64, times*rows*(1+c))
	// Only the selected columns are kept, however wide the rows they are read from.
	batch := max(1, (1<<20)/(stride*8))
	buffer := make([]float64, min(batch, rows)*stride)
	for done := 0; done < rows; {
		count := min(batch, rows-done)
		if _, err := view.files[level].ReadAt(raw(buffer[:count*stride]), int64(first+done)*int64(stride)*8); err != nil {
			return nil, err
		}
		for i := range count {
			row, at := buffer[i*stride:(i+1)*stride], done+i
			if level == 0 {
				out[at] = row[0]
				for j, column := range columns {
					out[rows+at*c+j] = row[1+column]
				}
			} else {
				out[at], out[rows+at] = row[0], row[1]
				for j, column := range columns {
					out[2*rows+at*c+j] = row[2+column]
					out[2*rows+rows*c+at*c+j] = row[2+s.width+column]
				}
			}
		}
		done += count
	}
	return out, nil
}

// sampled reads `count` rows from `first`, every `every`th: times, then values.
func (s *Store) sampled(view *Extent, first, count, every int, columns []int) ([]float64, error) {
	if every == 1 {
		return s.planes(view, 0, first, count, columns)
	}
	s.open.RLock()
	defer s.open.RUnlock()
	if s.shut {
		return nil, errExpired
	}
	c, stride := len(columns), s.width+1
	out, row := make([]float64, count*(1+c)), make([]float64, stride)
	for i := range count {
		if _, err := view.files[0].ReadAt(raw(row), int64(first+i*every)*int64(stride)*8); err != nil {
			return nil, err
		}
		out[i] = row[0]
		for j, column := range columns {
			out[count+i*c+j] = row[1+column]
		}
	}
	return out, nil
}

// search is the first of `count` rows whose time passes the test.
func (s *Store) search(view *Extent, count int, passes func(t float64) bool) (int, error) {
	s.open.RLock()
	defer s.open.RUnlock()
	if s.shut {
		return 0, errExpired
	}
	var failed error
	row := sort.Search(count, func(row int) bool {
		var t [1]float64
		if _, err := view.files[0].ReadAt(raw(t[:]), int64(row)*int64(s.width+1)*8); err != nil {
			failed = err
		}
		return passes(t[0])
	})
	return row, failed
}

// interval is the half-open rows around a time range, with one row beyond each end.
func (s *Store) interval(view *Extent, period *[2]float64) (int, int, error) {
	if view.rows == 0 {
		return 0, 0, nil
	}
	if period == nil {
		return 0, view.rows, nil
	}
	if period[1] < view.start || period[0] > view.end {
		return 0, 0, nil
	}
	left, err := s.search(view, view.rows, func(t float64) bool { return t >= period[0] })
	if err != nil {
		return 0, 0, err
	}
	right, err := s.search(view, view.rows, func(t float64) bool { return t > period[1] })
	return max(0, left-1), min(view.rows, right+1), err
}

// around is the last row at or before `at`, of `count`, and how many of up to `capacity` rows follow from it.
func (s *Store) around(view *Extent, count int, at float64, capacity int) (int, int, error) {
	if count == 0 {
		return 0, 0, nil
	}
	after, err := s.search(view, count, func(t float64) bool { return t > at })
	first := max(0, min(count-1, after-1))
	return first, min(count, first+capacity) - first, err
}

// writeCSV writes the recording as GridKit wrote it: it is kept once, as numbers.
func (s *Store) writeCSV(view *Extent, write func([]byte) error) error {
	all := make([]int, s.width)
	for i := range all {
		all[i] = i
	}
	if err := write([]byte("t," + strings.Join(s.columns, ",") + "\n")); err != nil {
		return err
	}
	batch := max(1, (1<<20)/((s.width+1)*8))
	text := make([]byte, 0, 1<<20)
	for first := 0; first < view.rows; first += batch {
		rows := min(batch, view.rows-first)
		values, err := s.planes(view, 0, first, rows, all)
		if err != nil {
			return err
		}
		text = text[:0]
		for row := range rows {
			text = strconv.AppendFloat(text, values[row], 'e', 16, 64)
			for _, value := range values[rows+row*s.width : rows+(row+1)*s.width] {
				text = strconv.AppendFloat(append(text, ','), value, 'e', 16, 64)
			}
			text = append(text, '\n')
		}
		if err := write(text); err != nil {
			return err
		}
	}
	return nil
}

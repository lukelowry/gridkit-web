package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"time"
)

// A reply is one transaction: a length-prefixed JSON header, then the FP64 planes it describes.
func writeHeader(w http.ResponseWriter, header any) error {
	meta, err := json.Marshal(header)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	_, err = w.Write(append(binary.LittleEndian.AppendUint32(make([]byte, 0, 4+len(meta)), uint32(len(meta))), meta...))
	return err
}

// held bounds a read that waits for new rows: the client asks again if nothing came.
func held(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 20*time.Second)
}

// RowsQuery asks for exact rows of some columns: from a row, or the last at or before a time.
type RowsQuery struct {
	Columns []string `json:"columns"`
	From    int      `json:"from"`
	At      *float64 `json:"at"`
	// Every Nth row from there, when the whole run would not fit the reader.
	Every int `json:"every"`
	Count int `json:"count"`
	// Hold until the recording passes `from`, or the run ends.
	Wait     bool `json:"wait"`
	MaxBytes int  `json:"maxBytes"`
}

// RowsHeader describes `count` rows from row `first`, then their times and time-major values.
type RowsHeader struct {
	Rows  int         `json:"rows"`
	State string      `json:"state"`
	Range *[2]float64 `json:"range"`
	First int         `json:"first"`
	Count int         `json:"count"`
}

func (s *Service) rows(w http.ResponseWriter, r *http.Request) error {
	run, store, err := s.recording(r)
	if err != nil {
		return err
	}
	var query RowsQuery
	if err := readQuery(w, r, &query); err != nil {
		return err
	}
	columns, err := store.selection(query.Columns)
	if err != nil {
		return err
	}
	if query.Every == 0 {
		query.Every = 1
	}
	if len(columns) == 0 || query.From < 0 || query.Every < 0 || query.Count < 0 || query.MaxBytes <= 0 || query.MaxBytes > maxReadBytes {
		return invalid("Invalid read.")
	}
	capacity := query.MaxBytes / (8 * (1 + len(columns)))
	if query.Count > 0 {
		capacity = min(capacity, query.Count)
	}
	if capacity == 0 {
		return invalid("The budget cannot fit a complete row.")
	}
	if query.Wait {
		ctx, cancel := held(r.Context())
		defer cancel()
		run.waitForRows(ctx, query.From)
	}
	state, err := run.current()
	if err != nil {
		return err
	}
	view := store.extent.Load()
	header := RowsHeader{Rows: view.rows, State: state, Range: view.timeRange(), First: query.From}
	if query.At != nil {
		if header.First, header.Count, err = store.around(view, view.rows, *query.At, capacity); err != nil {
			return err
		}
	} else if view.rows > query.From {
		header.Count = min(capacity, (view.rows-query.From+query.Every-1)/query.Every)
	}
	var values []float64
	if header.Count > 0 {
		if values, err = store.sampled(view, header.First, header.Count, query.Every, columns); err != nil {
			return err
		}
	}
	if err := writeHeader(w, header); err != nil {
		return err
	}
	_, err = w.Write(raw(values))
	return err
}

// SummaryQuery asks for a time range at a pixel width. A reader that has some of it says what it holds.
type SummaryQuery struct {
	Columns []string `json:"columns"`
	// The times to cover, or all of them.
	Range *[2]float64 `json:"range"`
	// Pixels across the range: no coarse bucket spans more than one.
	Resolution int `json:"resolution"`
	// The largest numeric payload of any tile.
	MaxBytes int     `json:"maxBytes"`
	Cursor   *Cursor `json:"cursor"`
	// Hold until the recording has more than this many rows, or the run ends.
	After *int `json:"after"`
}

// Cursor is the history a reader holds: `sealed` rows, from `first`, at one level of detail.
type Cursor struct {
	Level  int `json:"level"`
	First  int `json:"first"`
	Sealed int `json:"sealed"`
}

// Tile describes a run of native entries. Above level 0 an entry spans 8^level rows.
type Tile struct {
	Target string `json:"target"`
	Kind   string `json:"kind"`
	Level  int    `json:"level"`
	First  int    `json:"first"`
	Rows   int    `json:"rows"`
}

// SummaryHeader describes what extends a reader's history and the edges it replaces, then their planes in turn.
type SummaryHeader struct {
	Rows   int         `json:"rows"`
	State  string      `json:"state"`
	Range  *[2]float64 `json:"range"`
	Reset  bool        `json:"reset"`
	Cursor Cursor      `json:"cursor"`
	Tiles  []Tile      `json:"tiles"`
}

func (q *SummaryQuery) validate(columns int) error {
	switch {
	case columns == 0:
		return invalid("Choose columns to summarize.")
	case q.Resolution <= 0 || q.Resolution > maxStreamRows || q.MaxBytes < 4096 || q.MaxBytes > maxStreamBytes:
		return invalid("The summary's budget is outside the supported range.")
	case q.Range != nil && q.Range[0] > q.Range[1]:
		return invalid("Invalid time range.")
	case 16*(columns+1) > q.MaxBytes:
		return invalid("The selection is too wide for the summary's budget.")
	}
	return nil
}

// tiles partitions rows into aligned entries, finer at the edges, so no partial bucket is ever labelled as whole.
func tiles(target string, first, last, level, columns, maxBytes int) []Tile {
	var out []Tile
	for position := first; position < last; {
		power, span, kind, planes := 0, 1, "samples", 1
		for power < level && position%(span*8) == 0 && position+span*8 <= last {
			power, span, kind, planes = power+1, span*8, "envelope", 2
		}
		capacity := maxBytes / (8 * (columns + 1) * planes)
		end := position + span
		for end+span <= last && (end-position)/span < capacity && (power == level || end%(span*8) != 0) {
			end += span
		}
		out = append(out, Tile{target, kind, power, position / span, (end - position) / span})
		position = end
	}
	return out
}

// summarize plans one revision: the history a reader lacks, then the edges around it, which no history holds yet.
func summarize(store *Store, view *Extent, query *SummaryQuery, columns int) (SummaryHeader, error) {
	first, last, err := store.interval(view, query.Range)
	if err != nil {
		return SummaryHeader{}, err
	}
	period := [2]float64{view.start, view.end}
	if query.Range != nil {
		period = *query.Range
	}
	pixel := (period[1] - period[0]) / float64(query.Resolution)
	level, span := 0, 1
	for view.step > 0 && float64(span*8)*view.step <= pixel {
		level, span = level+1, span*8
	}
	start, end := (first+span-1)/span*span, last/span*span
	from, reset := start, query.Cursor == nil || query.Cursor.Level != level || query.Cursor.First != first
	if !reset {
		from = max(start, query.Cursor.Sealed)
	}
	header := SummaryHeader{Rows: view.rows, Range: view.timeRange(), Reset: reset, Cursor: Cursor{level, first, max(start, end)}, Tiles: []Tile{}}
	if end > from {
		header.Tiles = tiles("history", from, end, level, columns, query.MaxBytes)
	}
	if end < start {
		header.Tiles = append(header.Tiles, tiles("edge", first, last, level, columns, query.MaxBytes)...)
	} else {
		header.Tiles = append(header.Tiles, tiles("edge", first, min(start, last), level, columns, query.MaxBytes)...)
		header.Tiles = append(header.Tiles, tiles("edge", max(end, first), last, level, columns, query.MaxBytes)...)
	}
	return header, nil
}

func (s *Service) summary(w http.ResponseWriter, r *http.Request) error {
	run, store, err := s.recording(r)
	if err != nil {
		return err
	}
	var query SummaryQuery
	if err := readQuery(w, r, &query); err != nil {
		return err
	}
	columns, err := store.selection(query.Columns)
	if err != nil {
		return err
	}
	if err := query.validate(len(columns)); err != nil {
		return err
	}
	if query.After != nil {
		ctx, cancel := held(r.Context())
		defer cancel()
		run.waitForRows(ctx, *query.After)
	}
	state, err := run.current()
	if err != nil {
		return err
	}
	view := store.extent.Load()
	header, err := summarize(store, view, &query, len(columns))
	if err != nil {
		return err
	}
	header.State = state
	if err := writeHeader(w, header); err != nil {
		return err
	}
	flusher := http.NewResponseController(w)
	for _, tile := range header.Tiles {
		values, err := store.planes(view, tile.Level, tile.First, tile.Rows, columns)
		if err != nil {
			// The header is gone: only a broken body can say the transaction failed.
			panic(http.ErrAbortHandler)
		}
		if _, err := w.Write(raw(values)); err != nil {
			return nil
		}
		flusher.Flush()
	}
	return nil
}

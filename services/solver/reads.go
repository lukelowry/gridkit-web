package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"net/http"
)

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

// PlanesHeader describes `count` rows or entries from `first`, then their planes.
type PlanesHeader struct {
	Rows  int         `json:"rows"`
	State string      `json:"state"`
	Range *[2]float64 `json:"range"`
	First int         `json:"first"`
	Count int         `json:"count"`
}

// writePlanes answers a read as one transaction: a length-prefixed JSON header, then the FP64 planes it describes.
func writePlanes(w http.ResponseWriter, header PlanesHeader, values []float64) error {
	meta, err := json.Marshal(header)
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	if _, err := w.Write(append(binary.LittleEndian.AppendUint32(make([]byte, 0, 4+len(meta)), uint32(len(meta))), meta...)); err != nil {
		return err
	}
	_, err = w.Write(raw(values))
	return err
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
		ctx, cancel := context.WithTimeout(r.Context(), hold)
		defer cancel()
		run.waitForRows(ctx, query.From)
	}
	state, err := run.current()
	if err != nil {
		return err
	}
	view := store.extent.Load()
	header := PlanesHeader{Rows: view.rows, State: state, Range: view.timeRange(), First: query.From}
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
	return writePlanes(w, header, values)
}

// EntriesQuery asks for `count` entries of one level from entry `first`: rows at level 0, and above it buckets of 8^level rows,
// each the least and greatest of its rows. A level's last bucket holds the rows so far while it fills.
type EntriesQuery struct {
	Columns  []string `json:"columns"`
	Level    int      `json:"level"`
	First    int      `json:"first"`
	Count    int      `json:"count"`
	MaxBytes int      `json:"maxBytes"`
}

func (s *Service) entries(w http.ResponseWriter, r *http.Request) error {
	run, store, err := s.recording(r)
	if err != nil {
		return err
	}
	var query EntriesQuery
	if err := readQuery(w, r, &query); err != nil {
		return err
	}
	columns, err := store.selection(query.Columns)
	if err != nil {
		return err
	}
	view, planes := store.extent.Load(), 1+min(query.Level, 1)
	if len(columns) == 0 || query.Level < 0 || query.Level >= len(view.files) || query.First < 0 || query.Count <= 0 ||
		query.MaxBytes > maxReadBytes || 8*planes*query.Count*(1+len(columns)) > query.MaxBytes {
		return invalid("Invalid read.")
	}
	state, err := run.current()
	if err != nil {
		return err
	}
	header := PlanesHeader{Rows: view.rows, State: state, Range: view.timeRange(), First: query.First}
	header.Count = max(0, min(query.Count, view.entries(query.Level)-query.First))
	var values []float64
	if header.Count > 0 {
		if values, err = store.planes(view, query.Level, query.First, header.Count, columns); err != nil {
			return err
		}
	}
	return writePlanes(w, header, values)
}

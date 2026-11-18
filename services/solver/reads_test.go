package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func runWith(store *Store, state string) *Run {
	return &Run{id: "run", state: state, store: store, sequence: 1, changed: make(chan struct{}), done: make(chan struct{})}
}

// rowsOf is rows of [i/rate, value(i, c)...] from `first` to `last`.
func rowsOf(first, last, columns int, rate float64, value func(i, c int) float64) []float64 {
	rows := make([]float64, 0, (last-first)*(columns+1))
	for i := first; i < last; i++ {
		rows = append(rows, float64(i)/rate)
		for c := range columns {
			rows = append(rows, value(i, c))
		}
	}
	return rows
}

// The solver package's tests read the same fixture, so both sides of the stream agree on its format.
func TestSharedWireFixture(t *testing.T) {
	text, err := os.ReadFile("../../packages/solver/test/stream.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Columns []string    `json:"columns"`
		Rows    [][]float64 `json:"rows"`
		Replies struct {
			Rows    string `json:"rows"`
			Entries string `json:"entries"`
		} `json:"replies"`
	}
	if err := json.Unmarshal(text, &fixture); err != nil {
		t.Fatal(err)
	}
	store := newTestStore(t, fixture.Columns)
	for _, row := range fixture.Rows {
		if err := store.Append(row); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer((&Service{current: runWith(store, "completed")}).routes())
	defer server.Close()
	for route, check := range map[string]struct {
		query any
		want  string
	}{
		"rows": {RowsQuery{Columns: fixture.Columns, MaxBytes: 4096}, fixture.Replies.Rows},
		// The coarse level's whole bucket, and the one still filling.
		"entries": {EntriesQuery{Columns: fixture.Columns, Level: 1, Count: 2, MaxBytes: 4096}, fixture.Replies.Entries},
	} {
		text, _ := json.Marshal(check.query)
		response, err := http.Post(server.URL+"/runs/run/"+route, "application/json", bytes.NewReader(text))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if encoded := base64.StdEncoding.EncodeToString(body); encoded != check.want {
			t.Errorf("%s replies changed; the solver package's tests read this fixture too:\n%s", route, encoded)
		}
	}
}

// Entries stop at what the run has recorded; a read of a level it holds no whole entry of, or one past its budget, is refused.
func TestEntriesStopAtWhatIsRecordedAndRefuseWhatCannotFit(t *testing.T) {
	store := newTestStore(t, []string{"a"})
	if err := store.Append(rowsOf(0, 10, 1, 1, func(i, _ int) float64 { return float64(i) })); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer((&Service{current: runWith(store, "completed")}).routes())
	defer server.Close()
	address := server.URL + "/runs/run/entries"
	a := []string{"a"}
	for _, check := range []struct {
		query EntriesQuery
		count int
	}{
		{EntriesQuery{Columns: a, First: 8, Count: 8, MaxBytes: 4096}, 2},
		{EntriesQuery{Columns: a, First: 10, Count: 8, MaxBytes: 4096}, 0},
		{EntriesQuery{Columns: a, Level: 1, Count: 8, MaxBytes: 4096}, 2},
	} {
		var header PlanesHeader
		if answer(t, postJSON(t, address, check.query), &header); header.Count != check.count {
			t.Errorf("%+v: %+v", check.query, header)
		}
	}
	for _, query := range []EntriesQuery{
		{Columns: []string{}, Count: 1, MaxBytes: 4096},
		{Columns: a, Level: -1, Count: 1, MaxBytes: 4096},
		{Columns: a, Level: 2, Count: 1, MaxBytes: 4096},
		{Columns: a, First: -1, Count: 1, MaxBytes: 4096},
		{Columns: a, MaxBytes: 4096},
		// Two coarse entries are 64 bytes: their starts, ends, minima and maxima.
		{Columns: a, Level: 1, Count: 2, MaxBytes: 63},
		{Columns: a, Count: 1, MaxBytes: maxReadBytes + 1},
	} {
		if response := postJSON(t, address, query); response.StatusCode != http.StatusBadRequest || codeOf(t, response) != "invalid" {
			t.Errorf("%+v: %d", query, response.StatusCode)
		}
	}
}

func TestEveryNthRowReadsWhatItSays(t *testing.T) {
	store := newTestStore(t, names(3))
	if err := store.Append(rowsOf(0, 100, 3, 1, func(i, c int) float64 { return float64(i*10 + c) })); err != nil {
		t.Fatal(err)
	}
	values, err := store.sampled(store.extent.Load(), 5, 3, 10, []int{2, 0})
	if err != nil {
		t.Fatal(err)
	}
	want := []float64{5, 15, 25, 52, 50, 152, 150, 252, 250}
	for i := range want {
		if values[i] != want[i] {
			t.Fatalf("%v", values)
		}
	}
}

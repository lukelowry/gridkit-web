package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// page is one tile read back the way a client reads it.
type page struct {
	tile   Tile
	values []float64
}

func runWith(store *Store, state string) *Run {
	return &Run{id: "run", state: state, store: store, sequence: 1, changed: make(chan struct{}), done: make(chan struct{})}
}

// read plans a summary and reads its tiles.
func read(t *testing.T, store *Store, query *SummaryQuery) (SummaryHeader, []page) {
	t.Helper()
	columns, err := store.selection(query.Columns)
	if err != nil {
		t.Fatal(err)
	}
	if err := query.validate(len(columns)); err != nil {
		t.Fatal(err)
	}
	view := store.extent.Load()
	header, err := summarize(store, view, query, len(columns))
	if err != nil {
		t.Fatal(err)
	}
	pages := make([]page, len(header.Tiles))
	for i, tile := range header.Tiles {
		values, err := store.planes(view, tile.Level, tile.First, tile.Rows, columns)
		if err != nil {
			t.Fatal(err)
		}
		pages[i] = page{tile, values}
	}
	return header, pages
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
			Summary string `json:"summary"`
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
	service := &Service{current: runWith(store, "completed")}
	server := httptest.NewServer(service.routes())
	defer server.Close()
	for route, check := range map[string]struct {
		query any
		want  string
	}{
		"rows":    {RowsQuery{Columns: fixture.Columns, MaxBytes: 4096}, fixture.Replies.Rows},
		"summary": {SummaryQuery{Columns: fixture.Columns, Resolution: 100, MaxBytes: 4096}, fixture.Replies.Summary},
	} {
		text, _ := json.Marshal(check.query)
		response, err := http.Post(server.URL+"/runs/run/"+route, "application/json", bytes.NewReader(text))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if encoded := base64.StdEncoding.EncodeToString(body); encoded != check.want {
			t.Errorf("%s replies changed; src/simulation/wire.test.ts reads this fixture too:\n%s", route, encoded)
		}
	}
}

func TestTenThousandColumnsKeepExactTimesWhateverThePacketSize(t *testing.T) {
	columns := names(10000)
	store := newTestStore(t, columns)
	value := func(i, c int) float64 { return float64(i) + float64(c)/100000 }
	for first := 0; first < 1001; first += 26 {
		if err := store.Append(rowsOf(first, min(first+26, 1001), 10000, 100, value)); err != nil {
			t.Fatal(err)
		}
	}
	for _, budget := range []int{512 * 1024, 2 * 1024 * 1024} {
		period := [2]float64{0, 10}
		_, pages := read(t, store, &SummaryQuery{Columns: columns, Range: &period, Resolution: 1250, MaxBytes: budget})
		cursor := 0
		if len(pages) < 2 {
			t.Fatalf("%d pages at %d bytes", len(pages), budget)
		}
		for index, page := range pages {
			if len(page.values)*8 > budget {
				t.Errorf("page %d holds %d values", index, len(page.values))
			}
			if page.tile.Target != "history" || page.tile.Level != 0 || page.tile.First != cursor {
				t.Fatalf("%+v at %d", page.tile, cursor)
			}
			for row := range page.tile.Rows {
				at := cursor + row
				if page.values[row] != float64(at)/100 || page.values[page.tile.Rows+row*10000+9999] != value(at, 9999) {
					t.Fatalf("row %d", at)
				}
			}
			cursor += page.tile.Rows
		}
		if cursor != 1001 {
			t.Errorf("%d", cursor)
		}
	}
}

func TestPartialPyramidBoundariesAreCompleteAndSubpixel(t *testing.T) {
	store := newTestStore(t, []string{"c"})
	period := [2]float64{.03, 10}
	query := &SummaryQuery{Columns: []string{"c"}, Range: &period, Resolution: 12, MaxBytes: 4096}
	previous, sealed := 0, map[int]bool{}
	for _, count := range []int{63, 64, 65, 511, 512, 513, 959, 960, 961, 1001} {
		if err := store.Append(rowsOf(previous, count, 1, 100, func(i, _ int) float64 { return math.Sin(float64(i) / 100) })); err != nil {
			t.Fatal(err)
		}
		header, pages := read(t, store, query)
		query.Cursor = &header.Cursor
		if header.Reset {
			clear(sealed)
		}
		edges := map[int]bool{}
		for _, page := range pages {
			span := 1 << (3 * page.tile.Level)
			for row := page.tile.First * span; row < (page.tile.First+page.tile.Rows)*span; row++ {
				if sealed[row] {
					t.Fatalf("row %d is sent twice", row)
				}
				if page.tile.Target == "history" {
					sealed[row] = true
				} else {
					edges[row] = true
				}
			}
			if page.tile.Level > 0 {
				for i := range page.tile.Rows {
					if page.values[page.tile.Rows+i]-page.values[i] > (10-.03)/12 {
						t.Errorf("a bucket spans more than a pixel")
					}
				}
			}
		}
		first, last, err := store.interval(store.extent.Load(), &period)
		if err != nil {
			t.Fatal(err)
		}
		for row := first; row < last; row++ {
			if !sealed[row] && !edges[row] {
				t.Fatalf("row %d of [%d, %d) is missing at %d", row, first, last, count)
			}
		}
		if len(sealed)+len(edges) != last-first {
			t.Fatalf("%d + %d rows for [%d, %d)", len(sealed), len(edges), first, last)
		}
		previous = count
	}
}

func TestSummariesNeverRepeatHistoryAsARunGrows(t *testing.T) {
	columns := names(243)
	store := newTestStore(t, columns)
	query := &SummaryQuery{Columns: columns, Resolution: 64, MaxBytes: 4 * 1024 * 1024}
	entries, previous := map[[2]int]bool{}, 0
	for _, count := range []int{1, 40, 64, 65, 500, 1000, 1100, 1900, 20000} {
		if err := store.Append(rowsOf(previous, count, 243, 1000, func(i, c int) float64 { return math.Sin(float64(i)/1000) + float64(c) })); err != nil {
			t.Fatal(err)
		}
		header, pages := read(t, store, query)
		query.Cursor = &header.Cursor
		if header.Reset {
			clear(entries)
		}
		for _, page := range pages {
			span := 1 << (3 * page.tile.Level)
			if (page.tile.First+page.tile.Rows)*span > count {
				t.Errorf("%+v passes %d", page.tile, count)
			}
			if page.tile.Target == "history" {
				for index := page.tile.First; index < page.tile.First+page.tile.Rows; index++ {
					key := [2]int{page.tile.Level, index}
					if entries[key] {
						t.Errorf("%v is sent twice", key)
					}
					entries[key] = true
				}
			}
		}
		previous = count
	}
	again, pages := read(t, store, query)
	if again.Reset {
		t.Error("an unchanged revision reset")
	}
	for _, page := range pages {
		if page.tile.Target != "edge" {
			t.Errorf("%+v was sent again", page.tile)
		}
	}
}

func TestArbitraryViewportEdgesKeepActualLevels(t *testing.T) {
	store := newTestStore(t, []string{"c"})
	if err := store.Append(rowsOf(0, 10000, 1, 1, func(i, _ int) float64 { return float64(i) })); err != nil {
		t.Fatal(err)
	}
	view, cursor := store.extent.Load(), 3
	for _, tile := range tiles("history", 3, 9997, 4, 1, 4096) {
		span := 1 << (3 * tile.Level)
		if tile.First*span != cursor {
			t.Fatalf("%+v at %d", tile, cursor)
		}
		values, err := store.planes(view, tile.Level, tile.First, tile.Rows, []int{0})
		if err != nil {
			t.Fatal(err)
		}
		if values[0] != float64(tile.First*span) {
			t.Errorf("%+v starts at %g", tile, values[0])
		}
		if tile.Kind == "envelope" && values[tile.Rows]-values[0] != float64(span-1) {
			t.Errorf("%+v spans %g", tile, values[tile.Rows]-values[0])
		}
		cursor += tile.Rows * span
	}
	if cursor != 9997 {
		t.Errorf("%d", cursor)
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

func TestABudgetTooSmallIsRefused(t *testing.T) {
	for _, query := range []SummaryQuery{
		{Resolution: 0, MaxBytes: 4096},
		{Resolution: maxStreamRows + 1, MaxBytes: 4096},
		{Resolution: 1, MaxBytes: 4095},
		{Resolution: 1, MaxBytes: maxStreamBytes + 1},
		{Range: &[2]float64{2, 1}, Resolution: 1, MaxBytes: 4096},
	} {
		if query.validate(1) == nil {
			t.Errorf("%+v was accepted", query)
		}
	}
	wide := SummaryQuery{Resolution: 1, MaxBytes: 4096}
	if wide.validate(300) == nil || wide.validate(0) == nil {
		t.Error("a selection that does not fit was accepted")
	}
}

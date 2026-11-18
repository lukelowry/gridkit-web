package main

import (
	"bytes"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"testing"
)

func names(count int) []string {
	out := make([]string, count)
	for i := range out {
		out[i] = fmt.Sprintf("c%d", i)
	}
	return out
}

func newTestStore(t *testing.T, columns []string) *Store {
	t.Helper()
	store := newStore(t.TempDir(), columns)
	t.Cleanup(store.retire)
	return store
}

// Every level's entries are what folding their rows gives, the last one too while it fills, however the rows arrive. A gap stays a
// gap at every level: a bucket holding one is NaN.
func TestEveryLevelFoldsItsRowsTheLastWhileItFills(t *testing.T) {
	const width = 200
	store, columns, previous := newTestStore(t, names(width)), []int{width - 1, 3, 0}, 0
	value := func(i, c int) float64 {
		if i == 77 && c == 3 {
			return math.NaN()
		}
		return math.Sin(float64(i*(c+1)) / 50)
	}
	// fold is the least and greatest of rows first..last of `column`, or NaN where one has a gap.
	fold := func(first, last, column int) (float64, float64) {
		low, high := math.Inf(1), math.Inf(-1)
		for i := first; i <= last; i++ {
			v := value(i, column)
			if math.IsNaN(v) {
				return v, v
			}
			low, high = min(low, v), max(high, v)
		}
		return low, high
	}
	for _, count := range []int{1, 7, 8, 9, 63, 64, 65, 600, 1001} {
		if err := store.Append(rowsOf(previous, count, width, 100, value)); err != nil {
			t.Fatal(err)
		}
		previous = count
		view := store.extent.Load()
		for level := range len(view.files) {
			span, n := 1<<(3*level), view.entries(level)
			var starts, ends, lows, highs []float64
			for index := range n {
				first, last := index*span, min((index+1)*span, count)-1
				starts, ends = append(starts, float64(first)/100), append(ends, float64(last)/100)
				for _, column := range columns {
					low, high := fold(first, last, column)
					lows, highs = append(lows, low), append(highs, high)
				}
			}
			want := slices.Concat(starts, lows)
			if level > 0 {
				want = slices.Concat(starts, ends, lows, highs)
			}
			got, err := store.planes(view, level, 0, n, columns)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.EqualFunc(got, want, func(a, b float64) bool { return a == b || math.IsNaN(a) && math.IsNaN(b) }) {
				t.Fatalf("%d rows, level %d:\n%v\nwant %v", count, level, got, want)
			}
		}
	}
}

func TestReadsAroundATimeKeepEqualTimesAndGaps(t *testing.T) {
	store := newTestStore(t, []string{"c"})
	if err := store.Append([]float64{0, 1, 1, 2, 1, 3, 2, math.NaN()}); err != nil {
		t.Fatal(err)
	}
	view := store.extent.Load()
	first, rows, err := store.around(view, 4, 1, 2)
	if err != nil || first != 2 || rows != 2 {
		t.Fatalf("%d %d %v", first, rows, err)
	}
	values, err := store.planes(view, 0, first, rows, []int{0})
	if err != nil {
		t.Fatal(err)
	}
	if values[0] != 1 || values[1] != 2 || values[2] != 3 || !math.IsNaN(values[3]) {
		t.Errorf("%v", values)
	}
	// A pinned revision stops where it was.
	if first, rows, _ := store.around(view, 2, 30, 8); first != 1 || rows != 1 {
		t.Errorf("%d %d", first, rows)
	}
	if first, rows, _ := store.around(view, 0, 30, 8); first != 0 || rows != 0 {
		t.Errorf("%d %d", first, rows)
	}
	if first, _, _ := store.around(view, 4, -5, 1); first != 0 {
		t.Errorf("%d", first)
	}
}

func TestRefusesUnorderedOrInvalidTimes(t *testing.T) {
	store := newTestStore(t, []string{"a"})
	if err := store.Append([]float64{1, 0, 2, 0}); err != nil {
		t.Fatal(err)
	}
	for _, rows := range [][]float64{{1.5, 0}, {math.NaN(), 0}, {math.Inf(1), 0}} {
		if err := store.Append(rows); err == nil {
			t.Errorf("%v was accepted", rows)
		}
	}
	if rows := store.extent.Load().rows; rows != 2 {
		t.Errorf("%d", rows)
	}
}

func TestSelectionNamesWhatIsWrong(t *testing.T) {
	store := newTestStore(t, []string{"a", "b"})
	if columns, err := store.selection([]string{"b", "a"}); err != nil || columns[0] != 1 {
		t.Errorf("%v %v", columns, err)
	}
	if _, err := store.selection([]string{"missing"}); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Errorf("%v", err)
	}
	if _, err := store.selection([]string{"a", "a"}); err == nil {
		t.Error("a repeated column was accepted")
	}
}

func TestWritesTheRecordingAsGridKitWritesItsCSV(t *testing.T) {
	store := newTestStore(t, []string{"Bus_1_Vm", "Bus_1_Va"})
	var row []float64
	recording := recordingOf("t,Bus_1_Vm,Bus_1_Va", 0, 1.0370926850709157, -7.4044198300630096e-02)
	if err := readRecording(bytes.NewReader(recording), func([]string) error { return nil }, func(rows []float64) error { row = slices.Clone(rows); return nil }); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(row); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if err := store.writeCSV(store.extent.Load(), func(text []byte) error { out.Write(text); return nil }); err != nil {
		t.Fatal(err)
	}
	if want := "t,Bus_1_Vm,Bus_1_Va\n0.0000000000000000e+00,1.0370926850709157e+00,-7.4044198300630096e-02\n"; out.String() != want {
		t.Errorf("%s", out.String())
	}
}

func TestARetiredStoreRefusesReads(t *testing.T) {
	store := newStore(t.TempDir(), []string{"a"})
	if err := store.Append([]float64{0, 1}); err != nil {
		t.Fatal(err)
	}
	view := store.extent.Load()
	store.retire()
	if _, err := store.planes(view, 0, 0, 1, []int{0}); !errors.Is(err, errExpired) {
		t.Errorf("%v", err)
	}
}

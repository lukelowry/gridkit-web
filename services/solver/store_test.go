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

func TestExtremesSurviveEveryLevel(t *testing.T) {
	store := newTestStore(t, names(4))
	const count = 20000
	for first := 0; first < count; first += 127 {
		rows := make([]float64, 0, 127*5)
		for i := first; i < min(first+127, count); i++ {
			value := math.Sin(float64(i) / 1000)
			switch i {
			case 4031:
				value = 900
			case 8173:
				value = -700
			}
			rows = append(rows, float64(i)/1000, 0, value, 0, 0)
		}
		if err := store.Append(rows); err != nil {
			t.Fatal(err)
		}
	}
	view := store.extent.Load()
	if view.rows != count || view.start != 0 || view.end != 19.999 {
		t.Fatalf("%+v", view)
	}
	for level, span := 1, 8; span <= count; level, span = level+1, span*8 {
		rows := count / span
		values, err := store.planes(view, level, 0, rows, []int{1})
		if err != nil {
			t.Fatal(err)
		}
		if low, high := slices.Min(values[2*rows:3*rows]), slices.Max(values[3*rows:4*rows]); low != -700 || high != 900 {
			t.Errorf("level %d: [%g, %g]", level, low, high)
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

func TestAGapStaysAGapInCoarseEntries(t *testing.T) {
	store := newTestStore(t, []string{"a"})
	rows := make([]float64, 0, 128)
	for i := range 64 {
		value := float64(i)
		if i == 9 {
			value = math.NaN()
		}
		rows = append(rows, float64(i), value)
	}
	if err := store.Append(rows); err != nil {
		t.Fatal(err)
	}
	values, err := store.planes(store.extent.Load(), 1, 0, 2, []int{0})
	if err != nil {
		t.Fatal(err)
	}
	// Starts, ends, minima, maxima of two buckets: the first whole, the second holding the gap.
	if values[0] != 0 || values[1] != 8 || values[2] != 7 || values[3] != 15 || values[4] != 0 || !math.IsNaN(values[5]) || values[6] != 7 || !math.IsNaN(values[7]) {
		t.Fatalf("%v", values)
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

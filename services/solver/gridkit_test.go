package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"strings"
	"testing"
	"testing/iotest"
)

// doubles is values as GridKit writes them: doubles, little-endian on its platform, with no separators.
func doubles(values ...float64) []byte {
	var out []byte
	for _, value := range values {
		out = binary.LittleEndian.AppendUint64(out, math.Float64bits(value))
	}
	return out
}

// recordingOf is a recording as GridKit writes it: its header line, then its rows.
func recordingOf(header string, values ...float64) []byte {
	return append([]byte(header+"\n"), doubles(values...)...)
}

func TestReadsNumbersAsGridKitWritesThem(t *testing.T) {
	var columns []string
	var rows []float64
	// C++ writes a signed NaN.
	signed := math.Float64frombits(0xfff8000000000000)
	recording := recordingOf("t,Bus_1_Vm,Bus_1_Va", 0, 1.5, signed, 1, math.Inf(1), math.NaN())
	// The rows arrive however the pipe splits them.
	err := readRecording(iotest.OneByteReader(bytes.NewReader(recording)), func(names []string) error { columns = names; return nil },
		func(values []float64) error { rows = append(rows, values...); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(columns) != 2 || columns[0] != "Bus_1_Vm" || len(rows) != 6 {
		t.Fatalf("columns %v rows %v", columns, rows)
	}
	if rows[1] != 1.5 || !math.IsNaN(rows[2]) || !math.IsInf(rows[4], 1) || !math.IsNaN(rows[5]) {
		t.Fatalf("rows %v", rows)
	}
}

func TestRefusesARecordingItCannotTrust(t *testing.T) {
	begin, commit := func([]string) error { return nil }, func([]float64) error { return nil }
	for _, recording := range [][]byte{
		append(recordingOf("t,a", 0, 1), 0, 0, 0), // ends partway through a value
		recordingOf("t,a", 0, 1, 2),               // ends partway through a row
		recordingOf("a,b", 0, 1),                  // has no time column
		[]byte("t,a"),                             // its header never ends
	} {
		if err := readRecording(bytes.NewReader(recording), begin, commit); err == nil {
			t.Errorf("%q was accepted", recording)
		}
	}
}

func TestModelsPassThroughButCannotNameFiles(t *testing.T) {
	for text, good := range map[string]bool{
		`{"buses":[{"monitors":1}],"new_section":{"x":[1,2]}}`: true,
		`{"a":1}`: true,
		`{"monitors":[{"format":"CSV","file_name":"/x"}]}`: false,
		`[]`:         false,
		`{"buses":[`: false,
		``:           false,
	} {
		if err := checkModel(strings.NewReader(text)); (err == nil) != good {
			t.Errorf("%s: %v", text, err)
		}
	}
}

func TestFilesStayTheServicesChoice(t *testing.T) {
	text, err := solverSettings(map[string]any{"tmax": 1, "future_setting": "kept", "reference_file": "/etc/passwd", "output_file": "/data/x",
		"output_format": "csv", "system_model_file": "/etc/y"}, "/run/model.json")
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := json.Unmarshal(text, &settings); err != nil {
		t.Fatal(err)
	}
	if settings["output_file"] != recordingPath || settings["output_format"] != "binary" || settings["system_model_file"] != "/run/model.json" ||
		settings["future_setting"] != "kept" {
		t.Errorf("%v", settings)
	}
	if _, kept := settings["reference_file"]; kept {
		t.Errorf("%v", settings)
	}
}

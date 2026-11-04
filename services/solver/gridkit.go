package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// All this service knows of GridKit: the command, the settings naming files, and the recording it writes.
// A new model, output, event or solver setting passes through without touching this file.
const (
	solverCommand = "DynamicSimulation"
	// The recording's write end is the first extra file a child inherits.
	recordingPath = "/proc/self/fd/3"
)

// solverSettings fixes which files a run reads and writes, and that GridKit records numbers, not text; everything else is
// GridKit's to judge.
func solverSettings(settings map[string]any, model string) ([]byte, error) {
	delete(settings, "reference_file")
	settings["system_model_file"], settings["output_file"], settings["output_format"] = model, recordingPath, "binary"
	return json.Marshal(settings)
}

// checkModel reads a model through once: well-formed, and naming no output files of its own.
func checkModel(source io.Reader) error {
	decoder := json.NewDecoder(source)
	if open, err := decoder.Token(); err != nil || open != json.Delim('{') {
		return errors.New("expected a model object")
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return err
		}
		if key == "monitors" {
			return errors.New("a model cannot name its own output files")
		}
		for depth := 0; ; {
			token, err := decoder.Token()
			if err != nil {
				return err
			}
			if delim, ok := token.(json.Delim); ok {
				if delim == '{' || delim == '[' {
					depth++
				} else {
					depth--
				}
			}
			if depth == 0 {
				break
			}
		}
	}
	_, err := decoder.Token()
	return err
}

// readRecording parses a header naming the columns, then whole rows of doubles, t first, as they arrive. GridKit writes its
// machine's doubles beside this service, so the rows are read straight into the numbers committed, which `commit` must not
// keep.
func readRecording(source io.Reader, begin func(columns []string) error, commit func(rows []float64) error) error {
	reader := bufio.NewReader(source)
	header, err := reader.ReadString('\n')
	switch {
	case err == io.EOF && header == "":
		return nil
	case err == io.EOF:
		return errors.New("the recording ends in its header")
	case err != nil:
		return err
	}
	columns := strings.Split(strings.TrimSpace(header), ",")
	if len(columns) < 2 || columns[0] != "t" {
		return errors.New("the recording has no time column")
	}
	if err := begin(columns[1:]); err != nil {
		return err
	}
	// Room for one row, and as many more as fit in 256 KiB; it holds whatever was read past the header.
	width := len(columns)
	values := make([]float64, width*max(1, 32*1024/width))
	into := raw(values)
	read, _ := reader.Peek(reader.Buffered())
	filled := copy(into, read)
	// Whole rows are committed before waiting on more: GridKit may write some, then compute for a long time.
	for ended := false; ; {
		if rows := filled / (8 * width); rows > 0 {
			if err := commit(values[:rows*width]); err != nil {
				return err
			}
			filled = copy(into, into[rows*8*width:filled])
		}
		if ended {
			if filled > 0 {
				return errors.New("the recording ends in an incomplete row")
			}
			return nil
		}
		n, failed := source.Read(into[filled:])
		filled += n
		if failed == io.EOF {
			ended = true
		} else if failed != nil {
			return failed
		}
	}
}

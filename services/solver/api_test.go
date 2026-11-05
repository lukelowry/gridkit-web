package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const aModel = `{"buses":[]}`

func testService(t *testing.T) *httptest.Server { return tokenService(t, "") }

// tokenService answers on loopback, requiring `token` when it is set.
func tokenService(t *testing.T, token string) *httptest.Server {
	t.Helper()
	service, err := newService(t.TempDir(), token)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.routes())
	t.Cleanup(func() {
		server.Close()
		service.stop()
	})
	return server
}

// fakeSolver puts a shell script on the PATH as GridKit: it reads its recording descriptor as the real one does.
func fakeSolver(t *testing.T, script string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("a child inherits extra files on Unix only")
	}
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, solverCommand), []byte("#!/bin/sh\n"+script+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// printed is a shell command writing `recording` to GridKit's recording descriptor, byte for byte.
func printed(recording []byte) string {
	var text strings.Builder
	for _, b := range recording {
		fmt.Fprintf(&text, `\%03o`, b)
	}
	return "printf '" + text.String() + "' >&3"
}

func begin(t *testing.T, server *httptest.Server, solver, model string) *http.Response {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for name, text := range map[string]string{"solver": solver, "model": model} {
		part, err := form.CreateFormFile(name, name)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(part, text)
	}
	form.Close()
	response, err := http.Post(server.URL+"/runs", form.FormDataContentType(), &body)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func started(t *testing.T, server *httptest.Server) string {
	t.Helper()
	response := begin(t, server, `{"tmax":1}`, aModel)
	if response.StatusCode != http.StatusCreated {
		text, _ := io.ReadAll(response.Body)
		t.Fatalf("%d %s", response.StatusCode, text)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	return server.URL + "/runs/" + created.ID
}

func statusOf(t *testing.T, address string) Status {
	t.Helper()
	var status Status
	getJSON(t, address, http.StatusOK, &status)
	return status
}

func finished(t *testing.T, address string) Status {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for after := -1; time.Now().Before(deadline); {
		var status Status
		getJSON(t, address+"?after="+itoa(after), http.StatusOK, &status)
		if terminal(status.State) {
			return status
		}
		after = status.Sequence
	}
	t.Fatal("the run did not end")
	return Status{}
}

// answer reads a header and the FP64 planes after it.
func answer(t *testing.T, response *http.Response, header any) []float64 {
	t.Helper()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("%d %s", response.StatusCode, body)
	}
	size := binary.LittleEndian.Uint32(body)
	if err := json.Unmarshal(body[4:4+size], header); err != nil {
		t.Fatal(err)
	}
	planes := body[4+size:]
	values := make([]float64, len(planes)/8)
	for i := range values {
		values[i] = math.Float64frombits(binary.LittleEndian.Uint64(planes[i*8:]))
	}
	return values
}

func itoa(value int) string {
	text, _ := json.Marshal(value)
	return string(text)
}

func getJSON(t *testing.T, address string, status int, into any) {
	t.Helper()
	response, err := http.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	text, _ := io.ReadAll(response.Body)
	if response.StatusCode != status {
		t.Fatalf("%s: %d %s", address, response.StatusCode, text)
	}
	if into != nil {
		if err := json.Unmarshal(text, into); err != nil {
			t.Fatalf("%s: %v in %s", address, err, text)
		}
	}
}

func postJSON(t *testing.T, address string, body any) *http.Response {
	t.Helper()
	text, _ := json.Marshal(body)
	response, err := http.Post(address, "application/json", bytes.NewReader(text))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func codeOf(t *testing.T, response *http.Response) string {
	t.Helper()
	var failure Failure
	if err := json.NewDecoder(response.Body).Decode(&failure); err != nil {
		t.Fatal(err)
	}
	return failure.Code
}

func TestRoutesOwnTheirMethodsAndNothingElse(t *testing.T) {
	server := testService(t)
	for path, status := range map[string]int{
		"/":                  http.StatusNoContent,
		"/missing":           http.StatusNotFound,
		"/api/runs":          http.StatusNotFound,
		"/runs":              http.StatusMethodNotAllowed,
		"/runs/none/cancel":  http.StatusMethodNotAllowed,
		"/runs/none/missing": http.StatusNotFound,
		"/runs/none":         http.StatusGone,
		"/health":            http.StatusNoContent,
	} {
		response, err := http.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != status {
			t.Errorf("%s: %d", path, response.StatusCode)
		}
	}
}

func TestTheGateGuardsTheAPIButNotHealth(t *testing.T) {
	server := tokenService(t, "secret")
	request := func(path string, headers map[string]string, host string) *http.Response {
		r, _ := http.NewRequest(http.MethodGet, server.URL+path, nil)
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		if host != "" {
			r.Host = host
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { response.Body.Close() })
		return response
	}
	token := map[string]string{"Authorization": "Bearer secret"}
	refused := request("/", nil, "localhost")
	if refused.StatusCode != http.StatusUnauthorized || refused.Header.Get("WWW-Authenticate") != "Bearer" || codeOf(t, refused) != "authentication" {
		t.Errorf("%+v", refused)
	}
	for _, check := range []struct {
		path    string
		headers map[string]string
		host    string
		status  int
	}{
		{"/health", nil, "anywhere.test", http.StatusNoContent},
		{"/", map[string]string{"Authorization": "Bearer no"}, "localhost", http.StatusUnauthorized},
		{"/", token, "localhost", http.StatusNoContent},
		{"/", token, "[::1]:8080", http.StatusNoContent},
		{"/", map[string]string{"Authorization": "Bearer secret", "Origin": "http://localhost:8080"}, "localhost:8080", http.StatusNoContent},
		{"/", map[string]string{"Authorization": "Bearer secret", "Origin": "https://evil.test"}, "localhost:8080", http.StatusForbidden},
		{"/runs/none", map[string]string{"Authorization": "Bearer secret", "Origin": "http://localhost:9"}, "localhost:8080", http.StatusForbidden},
	} {
		if response := request(check.path, check.headers, check.host); response.StatusCode != check.status {
			t.Errorf("%+v: %d", check, response.StatusCode)
		}
	}
}

func TestARunRecordsAndServesWhatGridKitWrites(t *testing.T) {
	fakeSolver(t, `cat "$1" >&2`+"\n"+printed(recordingOf("t,Bus_1_Vm,Bus_1_Va", 0, 1, 2))+"\n"+printed(doubles(1, 3, 4)))
	server := testService(t)
	address := started(t, server)
	status := finished(t, address)
	if status.State != "completed" || status.Rows != 2 || *status.Range != [2]float64{0, 1} {
		t.Fatalf("%+v", status)
	}

	var rows RowsHeader
	values := answer(t, postJSON(t, address+"/rows", RowsQuery{Columns: []string{"Bus_1_Va"}, MaxBytes: 4096}), &rows)
	if rows.State != "completed" || rows.Rows != 2 || rows.Count != 2 || len(values) != 4 || values[3] != 4 {
		t.Fatalf("%+v %v", rows, values)
	}

	var summary SummaryHeader
	answer(t, postJSON(t, address+"/summary", SummaryQuery{Columns: []string{"Bus_1_Vm"}, Resolution: 100, MaxBytes: 4096}), &summary)
	if summary.State != "completed" || summary.Rows != 2 || !summary.Reset {
		t.Errorf("%+v", summary)
	}

	download := func(name string) string {
		response, err := http.Get(address + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if !strings.HasPrefix(response.Header.Get("Content-Disposition"), "attachment") {
			t.Errorf("%s: %v", name, response.Header)
		}
		text, _ := io.ReadAll(response.Body)
		return string(text)
	}
	if csv := download("results"); !strings.HasPrefix(csv, "t,Bus_1_Vm,Bus_1_Va\n0.0000000000000000e+00,1.0000000000000000e+00") {
		t.Errorf("%s", csv)
	}
	// The script writes the settings it was given to its log.
	if log := download("log"); !strings.Contains(log, recordingPath) || !strings.Contains(log, "model.json") {
		t.Errorf("%s", log)
	}
	if solver := download("solver"); !strings.Contains(solver, `"tmax":1`) || !strings.Contains(solver, `"output_format":"binary"`) {
		t.Errorf("%s", solver)
	}
}

func TestStatusWakesOnPublication(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1))+"; sleep 0.5")
	server := testService(t)
	address := started(t, server)
	first := statusOf(t, address)
	began := time.Now()
	var next Status
	getJSON(t, address+"?after="+itoa(first.Sequence+1000), http.StatusOK, &next)
	if !terminal(next.State) || time.Since(began) > 5*time.Second {
		t.Errorf("%+v after %v", next, time.Since(began))
	}
}

func TestAFailedRunSaysWhy(t *testing.T) {
	for script, code := range map[string]string{
		`exit 3`:                                "simulation",
		printed(recordingOf("t,a")):             "output", // no samples
		`exit 0`:                                "output",
		printed(recordingOf("t,a", 0, 1, 2)):    "output", // a partial row
		printed(recordingOf("t,a", 1, 0, 0, 1)): "output", // time running backwards
	} {
		t.Run(script, func(t *testing.T) {
			fakeSolver(t, script)
			status := finished(t, started(t, testService(t)))
			if status.State != "failed" || status.Error == nil || status.Error.Code != code {
				t.Errorf("%+v", status)
			}
		})
	}
}

func TestOneRunAtATimeAndABadRequestKeepsTheLast(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1))+`; while [ ! -e "$PWD/done" ]; do sleep 0.01; done`)
	server := testService(t)
	address := started(t, server)
	if response := begin(t, server, `{}`, aModel); response.StatusCode != http.StatusConflict || codeOf(t, response) != "busy" {
		t.Errorf("%d", response.StatusCode)
	}
	if response := postJSON(t, address+"/cancel", nil); response.StatusCode != http.StatusNoContent {
		t.Errorf("%d", response.StatusCode)
	}
	if status := finished(t, address); status.State != "cancelled" {
		t.Errorf("%+v", status)
	}
	for _, request := range [][2]string{
		{`{}`, `{"monitors":[{"format":"CSV","file_name":"/x"}]}`},
		{`{}`, `not json`},
		{`not json`, aModel},
		{`[]`, aModel},
	} {
		if response := begin(t, server, request[0], request[1]); response.StatusCode != http.StatusBadRequest || codeOf(t, response) != "invalid" {
			t.Errorf("%v: %d", request, response.StatusCode)
		}
	}
	if status := statusOf(t, address); status.State != "cancelled" {
		t.Errorf("%+v", status)
	}
}

func TestAnAbandonedUploadStartsNothingAndHoldsNothing(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1)))
	server := testService(t)
	body, writer := io.Pipe()
	form := multipart.NewWriter(writer)
	ctx, abandon := context.WithCancel(context.Background())
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/runs", body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	answered := make(chan struct{})
	go func() {
		defer close(answered)
		if response, err := http.DefaultClient.Do(request); err == nil {
			response.Body.Close()
		}
	}()
	go func() {
		solver, _ := form.CreateFormFile("solver", "solver")
		io.WriteString(solver, `{"tmax":1}`)
		model, _ := form.CreateFormFile("model", "model")
		io.WriteString(model, `{"buses":[`)
	}()
	// The upload is under way when a second is refused.
	deadline := time.Now().Add(5 * time.Second)
	for begin(t, server, `{}`, aModel).StatusCode != http.StatusConflict {
		if time.Now().After(deadline) {
			t.Fatal("the upload never began")
		}
	}
	abandon()
	writer.CloseWithError(io.ErrUnexpectedEOF)
	<-answered
	for {
		response := begin(t, server, `{"tmax":1}`, aModel)
		if response.StatusCode == http.StatusCreated {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("still refused: %d", response.StatusCode)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestStartingARunRetiresTheLast(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1)))
	server := testService(t)
	first := started(t, server)
	finished(t, first)
	second := started(t, server)
	finished(t, second)
	var failure Failure
	getJSON(t, first, http.StatusGone, &failure)
	if failure.Code != "expired" {
		t.Errorf("%+v", failure)
	}
}

func TestCancellingKeepsAReadablePartialResult(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1, 1, 2))+"; trap 'exit 1' TERM; while :; do sleep 0.01; done")
	server := testService(t)
	address := started(t, server)
	for statusOf(t, address).Rows < 2 {
		time.Sleep(10 * time.Millisecond)
	}
	if response := postJSON(t, address+"/cancel", nil); response.StatusCode != http.StatusNoContent {
		t.Errorf("%d", response.StatusCode)
	}
	status := statusOf(t, address)
	if status.State != "cancelled" || status.Rows != 2 {
		t.Errorf("%+v", status)
	}
	var header SummaryHeader
	answer(t, postJSON(t, address+"/summary", SummaryQuery{Columns: []string{"a"}, Resolution: 100, MaxBytes: 4096}), &header)
	if header.State != "cancelled" {
		t.Errorf("%+v", header)
	}
}

func TestMalformedQueriesAreTheClientsMistake(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1)))
	server := testService(t)
	address := started(t, server)
	finished(t, address)
	for path, query := range map[string]any{
		"/rows":    map[string]any{"columns": []string{"missing"}, "maxBytes": 64},
		"/summary": map[string]any{"columns": [][]string{{"a"}}, "resolution": 1, "maxBytes": 4096},
	} {
		if response := postJSON(t, address+path, query); response.StatusCode != http.StatusBadRequest || codeOf(t, response) != "invalid" {
			t.Errorf("%s: %d", path, response.StatusCode)
		}
	}
	for _, query := range []map[string]any{
		{"columns": []string{}, "maxBytes": 64},
		{"columns": []string{"a"}, "from": -1, "maxBytes": 64},
		{"columns": []string{"a"}, "every": -1, "maxBytes": 64},
		{"columns": []string{"a"}, "maxBytes": 8},
		{"columns": []string{"a"}, "maxBytes": maxReadBytes + 1},
	} {
		if response := postJSON(t, address+"/rows", query); response.StatusCode != http.StatusBadRequest {
			t.Errorf("%v: %d", query, response.StatusCode)
		}
	}
	var failure Failure
	getJSON(t, address+"?after=soon", http.StatusBadRequest, &failure)
}

func TestAWaitingReadWakesOnNewRowsAndStopsWithItsReader(t *testing.T) {
	fakeSolver(t, printed(recordingOf("t,a", 0, 1))+"; sleep 0.3; "+printed(doubles(1, 2))+"; while :; do sleep 0.01; done")
	server := testService(t)
	address := started(t, server)
	for statusOf(t, address).Rows < 1 {
		time.Sleep(10 * time.Millisecond)
	}
	began := time.Now()
	var rows RowsHeader
	values := answer(t, postJSON(t, address+"/rows", RowsQuery{Columns: []string{"a"}, From: 1, Wait: true, MaxBytes: 4096}), &rows)
	if rows.First != 1 || rows.Count != 1 || values[1] != 2 || time.Since(began) > 5*time.Second {
		t.Fatalf("%+v %v after %v", rows, values, time.Since(began))
	}
	// Nothing past this comes, so this reader waits until it leaves.
	ctx, leave := context.WithCancel(context.Background())
	text, _ := json.Marshal(RowsQuery{Columns: []string{"a"}, From: 2, Wait: true, MaxBytes: 4096})
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, address+"/rows", bytes.NewReader(text))
	left := make(chan error)
	go func() {
		_, err := http.DefaultClient.Do(request)
		left <- err
	}()
	time.Sleep(50 * time.Millisecond)
	leave()
	<-left
	// Closing a test server waits for its handlers, so it returns only if the feed has stopped.
	closed := make(chan struct{})
	go func() {
		server.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("the feed outlived its reader")
	}
}

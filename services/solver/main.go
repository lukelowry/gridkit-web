// The solver: runs one GridKit simulation at a time and serves the columns it records.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// Every image in this repository listens on 8080; the deployment chooses the published port.
const address = ":8080"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "health" {
		response, err := http.Get("http://127.0.0.1" + address + "/health")
		if err != nil || response.StatusCode != http.StatusNoContent {
			os.Exit(1)
		}
		return
	}
	stopping, release := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer release()
	service, err := newService("/data", os.Getenv("GRIDKIT_SOLVER_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: address, Handler: service.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-stopping.Done()
		service.stop()
		ending, finish := context.WithTimeout(context.Background(), 5*time.Second)
		defer finish()
		server.Shutdown(ending)
	}()
	if err := server.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

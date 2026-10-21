// Lab client for Go's net/http (reads HTTPS_PROXY; on macOS it verifies with the
// platform verifier, which ignores SSL_CERT_FILE).
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	e := os.Getenv
	seq0, _ := strconv.Atoi(e("LAB_SEQ0"))
	run, _ := strconv.Atoi(e("LAB_RUN"))
	port, _ := strconv.Atoi(e("LAB_PORT"))
	for i := 0; i < 3; i++ {
		seq := seq0 + i
		path := fmt.Sprintf("/e/%s/%d/%d", e("LAB_SC"), run, seq)
		body := fmt.Sprintf(`{"sc":%q,"run":%d,"seq":%d,"pad":%q}`, e("LAB_SC"), run, seq, strings.Repeat("x", 64))
		sum := sha256.Sum256([]byte(body))
		line, _ := json.Marshal(map[string]any{"sc": e("LAB_SC"), "run": run, "t": time.Now().UnixMilli(), "pid": os.Getpid(), "seq": seq,
			"kind": "http", "path": path, "port": port, "bodySha": hex.EncodeToString(sum[:]), "bodyLen": len(body)})
		f, _ := os.OpenFile(e("LAB_LEDGER"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		f.Write(append(line, '\n'))
		f.Close()
		resp, err := http.Post(fmt.Sprintf("https://%s:%d%s", e("LAB_HOST"), port, path), "application/json", bytes.NewBufferString(body))
		if err != nil {
			fmt.Fprintln(os.Stderr, "go", seq, err)
			continue
		}
		resp.Body.Close()
	}
}

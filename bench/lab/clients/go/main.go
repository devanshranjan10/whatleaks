// Lab client for Go's net/http (reads HTTPS_PROXY; on macOS it verifies with the
// platform verifier, which ignores SSL_CERT_FILE), and for raw sockets from a runtime
// whatleaks loads no hook into:
//
//	go-client                         three HTTPS POSTs
//	go-client tcp <holdMs> [reset|server-closes]
//	go-client udp unconnected
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func ledger(entry map[string]any) {
	line, _ := json.Marshal(entry)
	f, _ := os.OpenFile(os.Getenv("LAB_LEDGER"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	f.Write(append(line, '\n'))
	f.Close()
}

func raw(mode string, args []string) {
	e := os.Getenv
	seq, _ := strconv.Atoi(e("LAB_SEQ0"))
	run, _ := strconv.Atoi(e("LAB_RUN"))
	path := fmt.Sprintf("/e/%s/%d/%d", e("LAB_SC"), run, seq)
	entry := map[string]any{"sc": e("LAB_SC"), "run": run, "t": time.Now().UnixMilli(), "pid": os.Getpid(), "seq": seq, "path": path, "direct": true}
	if mode == "udp" {
		port, _ := strconv.Atoi(e("LAB_UDP_PORT"))
		entry["kind"], entry["port"] = "udp", port
		ledger(entry)
		c, err := net.ListenUDP("udp4", nil)
		if err != nil {
			fmt.Fprintln(os.Stderr, "udp", err)
			return
		}
		c.WriteTo([]byte(path+"\n"), &net.UDPAddr{IP: net.ParseIP(e("LAB_IP")), Port: port})
		time.Sleep(50 * time.Millisecond)
		c.Close()
		return
	}
	hold, _ := strconv.Atoi(args[0])
	how := ""
	if len(args) > 1 {
		how = args[1]
	}
	port, _ := strconv.Atoi(e("LAB_TCP_PORT"))
	entry["kind"], entry["port"], entry["holdMs"] = "tcp", port, hold
	ledger(entry)
	c, err := net.Dial("tcp4", net.JoinHostPort(e("LAB_IP"), strconv.Itoa(port)))
	if err != nil {
		fmt.Fprintln(os.Stderr, "tcp", err)
		return
	}
	msg := path
	if how == "server-closes" {
		msg += " close"
	}
	c.Write([]byte(msg + "\n"))
	time.Sleep(time.Duration(hold) * time.Millisecond)
	if how == "reset" {
		c.(*net.TCPConn).SetLinger(0)
	}
	c.Close()
}

func main() {
	if len(os.Args) > 1 {
		raw(os.Args[1], os.Args[2:])
		return
	}
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

# Lab client for Ruby (Net::HTTP reads http_proxy/https_proxy from the environment).
require 'net/http'
require 'json'
require 'digest'
E = ENV
seq0 = (E['LAB_SEQ0'] || '0').to_i
3.times do |i|
  seq = seq0 + i
  path = "/e/#{E['LAB_SC']}/#{E['LAB_RUN']}/#{seq}"
  body = JSON.generate({ sc: E['LAB_SC'], run: E['LAB_RUN'].to_i, seq: seq, pad: 'x' * 64 })
  File.open(E['LAB_LEDGER'], 'a') do |f|
    f.puts JSON.generate({ sc: E['LAB_SC'], run: E['LAB_RUN'].to_i, t: (Time.now.to_f * 1000).to_i, pid: Process.pid, seq: seq, kind: 'http',
                           path: path, port: E['LAB_PORT'].to_i, bodySha: Digest::SHA256.hexdigest(body), bodyLen: body.bytesize })
  end
  begin
    uri = URI("https://#{E['LAB_HOST']}:#{E['LAB_PORT']}#{path}")
    Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |h| h.post(uri.path, body, 'content-type' => 'application/json') }
  rescue StandardError => e
    warn "ruby #{seq}: #{e.class}: #{e.message}"
  end
end

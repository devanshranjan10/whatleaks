# whatleaks Ruby hook (loaded with RUBYOPT=-rwhatleaks_hook inside a whatleaks run only).
#
# Rubies linked against LibreSSL, such as macOS's /usr/bin/ruby, ignore SSL_CERT_FILE and
# refuse the run's CA. The default certificate store, which Net::HTTP and most clients
# use when they are not given their own CA, also trusts it here: the same trust
# SSL_CERT_FILE gives other Rubies, and only in this process tree. A client given its own
# ca_file or cert_store (pinning) is left alone. Nothing here may stop the app starting.
begin
  ca = ENV['WHATLEAKS_CA']
  if ca && File.file?(ca)
    require 'openssl'
    begin
      OpenSSL::SSL::SSLContext::DEFAULT_CERT_STORE.add_file(ca)
    rescue StandardError
      # already present
    end
    OpenSSL::X509::Store.class_eval do
      alias_method :__whatleaks_set_default_paths, :set_default_paths
      def set_default_paths
        result = __whatleaks_set_default_paths
        begin
          add_file(ENV['WHATLEAKS_CA']) if ENV['WHATLEAKS_CA']
        rescue StandardError
          # already present, or the file went away with the run
        end
        result
      end
    end
  end
rescue StandardError, LoadError
  nil
end

# Every TCP connection and UDP destination outside the proxy, written one line each to
# WHATLEAKS_SOCKETS as it happens: a poll misses sockets that live a few milliseconds,
# and UDP sent without connect() has no peer to poll. Loopback is skipped.
begin
  if ENV['WHATLEAKS_SOCKETS']
    require 'socket'
    require 'json'
    module WhatleaksSockets
      LOCK = Mutex.new
      UDP_SEEN = {}
      @lines = 0
      @io = nil
      CMD = begin
        require 'rbconfig'
        File.basename(RbConfig.ruby)
      rescue StandardError, LoadError
        'ruby'
      end

      def self.report(proto, addr, port, host = nil)
        return if addr.nil? || port.nil? || port.to_i.zero?
        addr = addr.to_s
        return if addr == 'localhost' || addr == '::1' || addr.start_with?('127.', '::ffff:127.')
        LOCK.synchronize do
          return if @lines >= 10_000
          if proto == 'UDP'
            return if UDP_SEEN[[addr, port.to_i]]
            UDP_SEEN[[addr, port.to_i]] = true
          end
          line = { proto: proto, addr: addr, port: port.to_i, pid: Process.pid, cmd: CMD, t: (Time.now.to_f * 1000).to_i }
          line[:host] = host.to_s if host && host.to_s != addr
          begin
            @io ||= File.open(ENV['WHATLEAKS_SOCKETS'], File::WRONLY | File::APPEND | File::CREAT, 0o600)
            @io.syswrite(JSON.generate(line) + "\n")
            @lines += 1
          rescue StandardError
            @lines = 10_000
          end
        end
      end

      def self.peer(sock, proto, host = nil)
        a = sock.remote_address
        report(proto, a.ip_address, a.ip_port, host) if a.ip?
      rescue StandardError
        nil
      end

      module TCP
        def initialize(host, port, *rest, **kw)
          kw.empty? ? super(host, port, *rest) : super
          WhatleaksSockets.peer(self, 'TCP', host)
        end
      end

      module Sock
        def connect(addr)
          r = super
          WhatleaksSockets.peer(self, local_address.socktype == ::Socket::SOCK_DGRAM ? 'UDP' : 'TCP')
          r
        end

        def connect_nonblock(addr, *rest, **kw)
          begin
            kw.empty? ? super(addr, *rest) : super
          ensure
            begin
              a = ::Addrinfo.new(addr)
              WhatleaksSockets.report('TCP', a.ip_address, a.ip_port) if a.ip?
            rescue StandardError
              nil
            end
          end
        end
      end

      module UDP
        def connect(host, port)
          r = super
          WhatleaksSockets.peer(self, 'UDP', host)
          r
        end

        def send(mesg, flags, *dest)
          if dest.length >= 2
            begin
              ip = ::Addrinfo.getaddrinfo(dest[0], dest[1], nil, :DGRAM).first
              WhatleaksSockets.report('UDP', ip.ip_address, ip.ip_port, dest[0]) if ip
            rescue StandardError
              nil
            end
          else
            WhatleaksSockets.peer(self, 'UDP')
          end
          super
        end
      end
    end
    TCPSocket.prepend(WhatleaksSockets::TCP)
    Socket.prepend(WhatleaksSockets::Sock)
    UDPSocket.prepend(WhatleaksSockets::UDP)
  end
rescue StandardError, LoadError
  nil
end

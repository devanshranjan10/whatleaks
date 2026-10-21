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

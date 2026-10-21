// Lab client for Java's built-in HttpClient. Run with: java Client.java
import java.io.FileWriter;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.MessageDigest;
import java.util.HexFormat;

public class Client {
  public static void main(String[] a) throws Exception {
    var e = System.getenv();
    int seq0 = Integer.parseInt(e.getOrDefault("LAB_SEQ0", "0"));
    var client = HttpClient.newHttpClient();
    for (int i = 0; i < 3; i++) {
      int seq = seq0 + i;
      String path = "/e/" + e.get("LAB_SC") + "/" + e.get("LAB_RUN") + "/" + seq;
      String body = "{\"sc\":\"" + e.get("LAB_SC") + "\",\"run\":" + e.get("LAB_RUN") + ",\"seq\":" + seq + ",\"pad\":\"" + "x".repeat(64) + "\"}";
      byte[] bytes = body.getBytes("UTF-8");
      String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
      try (var w = new FileWriter(e.get("LAB_LEDGER"), true)) {
        w.write("{\"sc\":\"" + e.get("LAB_SC") + "\",\"run\":" + e.get("LAB_RUN") + ",\"t\":" + System.currentTimeMillis() + ",\"pid\":" + ProcessHandle.current().pid()
            + ",\"seq\":" + seq + ",\"kind\":\"http\",\"path\":\"" + path + "\",\"port\":" + e.get("LAB_PORT") + ",\"bodySha\":\"" + sha + "\",\"bodyLen\":" + bytes.length + "}\n");
      }
      try {
        var req = HttpRequest.newBuilder(URI.create("https://" + e.get("LAB_HOST") + ":" + e.get("LAB_PORT") + path))
            .header("content-type", "application/json").POST(HttpRequest.BodyPublishers.ofByteArray(bytes)).build();
        client.send(req, HttpResponse.BodyHandlers.discarding());
      } catch (Exception ex) {
        System.err.println("java " + seq + ": " + ex);
      }
    }
  }
}

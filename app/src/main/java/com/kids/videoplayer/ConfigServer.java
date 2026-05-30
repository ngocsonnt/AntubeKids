package com.kids.videoplayer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;

/**
 * Tiny on-demand HTTP server: lets a phone on the same Wi-Fi set the Google
 * Sheet link without typing on the projector remote.
 *
 *   GET  /  -> a simple form (prefilled with the current link)
 *   POST /  -> saves the submitted "url" field and notifies the app
 *
 * Pure java.net (no dependency). Started only while the user opens the
 * "Enter from phone" screen, and stopped right after — so it costs nothing
 * during normal playback.
 */
public class ConfigServer {

    public interface Listener { void onUrl(String url); }

    private final int port;
    private final String currentUrl;
    private final Listener listener;
    private ServerSocket serverSocket;
    private volatile boolean running;

    public ConfigServer(int port, String currentUrl, Listener listener) {
        this.port = port;
        this.currentUrl = currentUrl == null ? "" : currentUrl;
        this.listener = listener;
    }

    public void start() throws IOException {
        serverSocket = new ServerSocket(port);
        running = true;
        Thread t = new Thread(this::acceptLoop);
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        running = false;
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = serverSocket.accept();
                Thread t = new Thread(() -> handle(s));
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                break; // socket closed -> exit
            }
        }
    }

    private void handle(Socket sock) {
        try {
            sock.setSoTimeout(15000);
            InputStream in = sock.getInputStream();

            String requestLine = readLine(in);
            if (requestLine == null) { sock.close(); return; }

            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && line.length() > 0) {
                int idx = line.indexOf(':');
                if (idx > 0 && line.substring(0, idx).trim().equalsIgnoreCase("Content-Length")) {
                    try { contentLength = Integer.parseInt(line.substring(idx + 1).trim()); }
                    catch (NumberFormatException ignored) {}
                }
            }

            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "GET";

            if ("POST".equalsIgnoreCase(method)) {
                byte[] buf = new byte[Math.max(0, contentLength)];
                int read = 0;
                while (read < contentLength) {
                    int n = in.read(buf, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }
                String body = new String(buf, 0, read, "UTF-8");
                String url = parseField(body, "url");
                if (url != null && url.length() > 0 && listener != null) listener.onUrl(url);
                respond(sock, successHtml());
            } else {
                respond(sock, formHtml());
            }
        } catch (Exception ignored) {
        } finally {
            try { sock.close(); } catch (IOException ignored) {}
        }
    }

    private String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        int c, count = 0;
        while ((c = in.read()) != -1) {
            count++;
            if (c == '\n') break;
            if (c == '\r') continue;
            bo.write(c);
        }
        if (c == -1 && count == 0) return null;
        return new String(bo.toByteArray(), "UTF-8");
    }

    private String parseField(String body, String name) {
        if (body == null) return null;
        String[] pairs = body.split("&");
        for (String p : pairs) {
            int eq = p.indexOf('=');
            if (eq <= 0) continue;
            String k = p.substring(0, eq);
            if (k.equals(name)) {
                try { return URLDecoder.decode(p.substring(eq + 1), "UTF-8"); }
                catch (Exception e) { return p.substring(eq + 1); }
            }
        }
        return null;
    }

    private void respond(Socket sock, String html) throws IOException {
        byte[] body = html.getBytes("UTF-8");
        OutputStream os = sock.getOutputStream();
        String headers = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/html; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        os.write(headers.getBytes("UTF-8"));
        os.write(body);
        os.flush();
    }

    private String esc(String s) {
        return s.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private String formHtml() {
        return "<!doctype html><html><head><meta charset=utf-8>"
            + "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
            + "<title>Antube Kids</title><style>"
            + "body{font-family:sans-serif;margin:0;padding:24px;background:#101522;color:#fff}"
            + "h1{font-size:20px}.note{color:#9fb3d1;font-size:14px;margin:8px 0 16px}"
            + "input{width:100%;font-size:18px;padding:14px;border-radius:10px;border:1px solid #3a465e;"
            + "background:#0f1420;color:#fff;box-sizing:border-box}"
            + "button{margin-top:16px;width:100%;font-size:18px;font-weight:700;padding:16px;border:0;"
            + "border-radius:10px;background:#3d5afe;color:#fff}</style></head><body>"
            + "<h1>🎬 Antube Kids — set video list</h1>"
            + "<p class=note>Paste the Google Sheet link (shared “Anyone with the link → Viewer”), then Send.</p>"
            + "<form method=POST action=\"/\">"
            + "<input name=url type=url placeholder=\"https://docs.google.com/spreadsheets/d/...\" value=\""
            + esc(currentUrl) + "\">"
            + "<button type=submit>Send to projector</button></form></body></html>";
    }

    private String successHtml() {
        return "<!doctype html><html><head><meta charset=utf-8>"
            + "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
            + "<title>Antube Kids</title><style>"
            + "body{font-family:sans-serif;margin:0;padding:40px 24px;background:#101522;color:#fff;text-align:center}"
            + "h1{font-size:48px;margin:0}p{font-size:18px;color:#9fb3d1}</style></head><body>"
            + "<h1>✅</h1><p>Saved! The projector is loading your list.<br>You can close this page.</p>"
            + "</body></html>";
    }
}

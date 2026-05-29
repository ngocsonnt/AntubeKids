package com.kids.videoplayer;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Kiosk-style host for the kids' video player.
 * The whole UI lives in assets/index.html; this Activity only provides a
 * full-screen WebView and a small native bridge that fetches the Google Sheet
 * CSV (done natively to avoid WebView cross-origin restrictions).
 */
public class MainActivity extends Activity {

    // Virtual https origin used to serve the bundled assets (no real network).
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + APP_HOST + "/index.html";

    private WebView webView;
    private SharedPreferences prefs;
    private FrameLayout root;

    // YouTube native-fullscreen support
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = getSharedPreferences("cfg", Context.MODE_PRIVATE);

        root = new FrameLayout(this);
        setContentView(root);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setDatabaseEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        webView.setBackgroundColor(0xFF000000);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                root.addView(customView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
                hideSystemUi();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                webView.setVisibility(View.VISIBLE);
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
                customViewCallback = null;
                hideSystemUi();
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep navigation inside the app. The YouTube embed loads internally.
                return false;
            }

            // Serve the bundled UI (index.html/app.js/style.css) over a valid
            // https origin so the YouTube IFrame Player accepts it. file:// gives
            // a "null" origin and triggers the "configuration error" (153).
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && APP_HOST.equals(u.getHost())) {
                    String path = u.getPath();
                    if (path == null || path.equals("/")) path = "/index.html";
                    String asset = path.startsWith("/") ? path.substring(1) : path;
                    try {
                        InputStream is = getAssets().open(asset);
                        return new WebResourceResponse(guessMime(asset), "utf-8", is);
                    } catch (IOException e) {
                        return null;
                    }
                }
                return null;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushScreenInfo();
            }
        });

        webView.addJavascriptInterface(new Bridge(), "Native");
        webView.loadUrl(APP_URL);
    }

    /** Read the projector's real resolution + density and hand it to the web layer. */
    private void pushScreenInfo() {
        if (webView == null) return;
        DisplayMetrics dm = new DisplayMetrics();
        try {
            getWindowManager().getDefaultDisplay().getRealMetrics(dm);
        } catch (Exception e) {
            dm = getResources().getDisplayMetrics();
        }
        int w = dm.widthPixels;
        int h = dm.heightPixels;
        float d = dm.density <= 0 ? 1f : dm.density;
        final String js = "window.applyScreen && window.applyScreen(" + w + "," + h + "," + d + ");";
        webView.evaluateJavascript(js, null);
    }

    private void hideSystemUi() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) { hideSystemUi(); pushScreenInfo(); }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Forward the Menu / remote-menu key to the web layer (opens Settings).
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            webView.evaluateJavascript("window.appOpenSettings && window.appOpenSettings()", null);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            webView.getWebChromeClient().onHideCustomView();
            return;
        }
        // Let the web layer handle Back first (close overlay / return to grid).
        webView.evaluateJavascript(
                "window.appHandleBack ? window.appHandleBack() : false",
                value -> {
                    if (!"true".equals(value)) {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
            webView.evaluateJavascript("window.appPause && window.appPause()", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        hideSystemUi();
    }

    /** Bridge exposed to JavaScript as window.Native */
    private class Bridge {

        @JavascriptInterface
        public String getSheetUrl() {
            return prefs.getString("sheetUrl", "");
        }

        @JavascriptInterface
        public void saveSheetUrl(String url) {
            prefs.edit().putString("sheetUrl", url == null ? "" : url.trim()).apply();
        }

        @JavascriptInterface
        public void fetchCsv(final String url) {
            new Thread(() -> {
                try {
                    String csv = httpGet(url, 0);
                    deliver("window.onCsvLoaded", csv);
                } catch (Exception e) {
                    String msg = e.getMessage();
                    deliver("window.onCsvError", msg == null ? "Could not load data" : msg);
                }
            }).start();
        }

        // Fetch the spreadsheet's htmlview page so the web layer can list its tabs.
        @JavascriptInterface
        public void fetchSheets(final String url) {
            new Thread(() -> {
                try {
                    String html = httpGet(url, 0);
                    deliver("window.onSheetsHtml", html);
                } catch (Exception e) {
                    deliver("window.onSheetsError", e.getMessage() == null ? "error" : e.getMessage());
                }
            }).start();
        }

        @JavascriptInterface
        public String getAppVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }

    private void deliver(final String fn, final String arg) {
        final String js = fn + "(" + JSONObject.quote(arg) + ");";
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(js, null);
        });
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        return "text/plain";
    }

    private String httpGet(String urlStr, int depth) throws Exception {
        if (depth > 5) throw new Exception("Too many redirects");
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) KidsVideoPlayer");
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                if (loc != null) {
                    conn.disconnect();
                    return httpGet(loc, depth + 1);
                }
            }
            if (code != 200) {
                throw new Exception("Server returned code " + code);
            }
            BufferedReader r = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append("\n");
            }
            r.close();
            return sb.toString();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}

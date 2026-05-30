# Hướng dẫn tạo lại ứng dụng "Antube Kids"

Tài liệu này tóm tắt toàn bộ cách xây dựng một app Android phát video YouTube cho trẻ em
trên **máy chiếu smart / Android TV**, với danh sách video lấy từ **Google Sheet công khai**
(không cần đăng nhập). Bao gồm cả các **lỗi thực tế đã gặp và cách khắc phục** — phần này
quan trọng nhất, vì đa số là những thứ không thấy trước được.

> Mục tiêu thiết kế: đơn giản, bền, **không cần OAuth/đăng nhập**, dễ cập nhật danh sách
> từ điện thoại, chạy được trên máy chiếu đời cũ.

---

## 1. Ý tưởng & kiến trúc

- **Vỏ Android tối giản (WebView kiosk):** một `Activity` full-screen chứa `WebView`. Toàn bộ
  giao diện nằm trong `assets/` (HTML/CSS/JS). Native chỉ làm 2 việc: hiển thị WebView và
  cung cấp **cầu nối (JavaScript bridge)** để tải dữ liệu.
- **Danh sách video:** đọc từ Google Sheet **công khai** dưới dạng CSV. Tải ở **tầng native**
  (Java `HttpURLConnection`) để **tránh lỗi CORS** của WebView.
- **Phát video:** dùng **YouTube IFrame Player API** (không cần API key, không đăng nhập).
- **Vì sao không dùng OAuth/API key:** đăng nhập Google trên TV/máy chiếu rất phiền (gõ
  remote, token hết hạn). Sheet công khai + video công khai chạy ổn định mà không cần gì cả.

```
Máy chiếu (Android) ──HDMI──> màn chiếu
   └─ App (WebView kiosk)
        ├─ assets/index.html + app.js + style.css   ← toàn bộ UI
        ├─ JavaScript bridge "Native"               ← tải CSV/HTML, lấy version, độ phân giải
        └─ <iframe> YouTube IFrame Player            ← phát video
   ⇅ HTTPS
Google Sheet (công khai)  →  CSV qua gviz  +  danh sách tab qua htmlview
YouTube                   →  IFrame Player
```

---

## 2. Môi trường

- **Android Studio** (kèm sẵn JDK 17/21 và Android SDK).
- Phiên bản đã dùng: **AGP 8.7.2**, **Gradle 8.10.2**, **compileSdk 35**, **minSdk 26**
  (Android 8.0 — đủ cho hầu hết máy chiếu smart), **targetSdk 35**.
- Ngôn ngữ: **Java thuần** (không cần Kotlin plugin → ít ràng buộc phiên bản).
- **Không phụ thuộc thư viện bên thứ ba** (không AndroidX) → APK ~90KB.

Build từ dòng lệnh:
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug
# Kết quả: app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. Cấu trúc project

```
AntubeKids/
├─ settings.gradle, build.gradle, gradle.properties
├─ gradle/wrapper/…, gradlew
├─ app/
│  ├─ build.gradle               (namespace, sdk, version)
│  ├─ proguard-rules.pro
│  └─ src/main/
│     ├─ AndroidManifest.xml
│     ├─ java/com/kids/videoplayer/MainActivity.java
│     ├─ assets/index.html, app.js, style.css   ← TRÁI TIM của app
│     └─ res/
│        ├─ values/strings.xml, ic_launcher_background.xml
│        ├─ xml/network_security_config.xml      ← fix chứng chỉ (mục 8.1)
│        ├─ raw/gts_r1..r4.pem                    ← root CA Google
│        ├─ mipmap-*/ic_launcher*.png             ← icon
│        └─ drawable-nodpi/tv_banner.png
└─ make_icons.py                  ← script tạo icon từ 1 ảnh logo
```

**Manifest** điểm chính:
- Quyền `INTERNET`.
- `uses-feature android.hardware.touchscreen required=false` + category
  `LEANBACK_LAUNCHER` → cài & hiện được trên Android TV.
- `android:screenOrientation="landscape"`, theme fullscreen.
- `android:networkSecurityConfig="@xml/network_security_config"` (mục 8.1).

---

## 4. Google Sheet: định dạng & cách đọc KHÔNG cần đăng nhập

**Định dạng:** chia sẻ "Anyone with the link → Viewer". Mỗi video 1 dòng:
cột A = tên, cột B = link YouTube. Dòng tiêu đề tự bỏ qua.

**Đọc CSV (1 tab):** dùng endpoint gviz (chỉ cần sheet công khai, không cần "Publish to web"):
```
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv          (tab đầu)
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=<GID> (tab cụ thể)
```

**Liệt kê các tab (không cần API key!):** trang `htmlview` mở được với sheet công khai và
chứa danh sách tab trong JS bootstrap:
```
https://docs.google.com/spreadsheets/d/<ID>/htmlview
```
Bên trong có các dòng dạng:
```js
items.push({name: "Videos", pageUrl: "…/htmlview/sheet?…&gid=0", …});
items.push({name: "Copy of Videos", pageUrl: "…&gid=708765030", …});
```
Regex bóc tên + gid (đã dùng trong `app.js`):
```js
/items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"[^"]*?gid\\?=(\d+)/g
```
→ Nếu > 1 tab thì hiện panel "Playlists" bên phải để chọn.

> **Vì sao tải ở native, không fetch() trong JS:** WebView áp dụng CORS; `fetch()` tới
> docs.google.com từ origin của app sẽ bị chặn. Tải bằng `HttpURLConnection` ở Java thì
> không dính CORS, lại tự theo redirect và cache offline được.

---

## 5. Native ↔ Web (JavaScript bridge)

`MainActivity` đăng ký `addJavascriptInterface(new Bridge(), "Native")`. Các hàm chính:

| JS gọi | Native làm |
|---|---|
| `Native.fetchCsv(url)` | tải CSV trên thread, trả về `window.onCsvLoaded(text)` / `onCsvError(msg)` |
| `Native.fetchSheets(htmlviewUrl)` | tải htmlview, trả về `window.onSheetsHtml(html)` |
| `Native.getSheetUrl()` / `saveSheetUrl(url)` | đọc/ghi link sheet vào SharedPreferences |
| `Native.getAppVersion()` | trả về versionName (hiện trong Settings) |

Native chủ động gọi vào web (sau khi trang load xong):
| Native gọi | Ý nghĩa |
|---|---|
| `window.applyScreen(wPx, hPx, density)` | đưa **độ phân giải thật** vào web (mục 8.3) |
| `window.appHandleBack()` | xử lý nút Back; trả `true` nếu web đã xử lý |
| `window.appOpenSettings()` | mở Settings từ phím Menu của remote |

Trả dữ liệu từ Java về JS an toàn bằng `JSONObject.quote()`:
```java
String js = fn + "(" + JSONObject.quote(arg) + ");";
runOnUiThread(() -> webView.evaluateJavascript(js, null));
```

---

## 6. Giao diện (assets)

- **Lưới thumbnail** (`<img src="https://i.ytimg.com/vi/<id>/hqdefault.jpg">`), tile to, có số.
- **Điều khiển bằng cả chạm lẫn remote (D-pad):** tự xử lý phím mũi tên qua `keydown`, với
  các "vùng focus" (zone): `grid` ↔ `header` (nút 🔄/⚙️) ↔ `sheets` (panel playlist).
- **Trình phát:** tạo `YT.Player`, tự phát video kế tiếp khi `ENDED`, bỏ qua video chặn nhúng
  (`onError`). Dùng **thanh điều khiển gốc của YouTube** (`controls:1`, có thanh thời gian);
  phím remote vẫn điều khiển qua IFrame API (OK = play/pause, ◀▶ = seek 10s, ▲▼ = chuyển video).
  Lưu ý: KHÔNG phủ overlay trong suốt lên iframe, nếu không sẽ chặn thao tác lên thanh YouTube.
- **Cache:** lưu danh sách vào `localStorage` để mất mạng tạm vẫn xem được.

---

## 7. Icon từ một ảnh logo

`make_icons.py` (dùng Pillow) sinh đủ mật độ icon + banner TV từ 1 ảnh `youtube_icon.png`:
- Adaptive icon: nền trắng + foreground là logo căn giữa vùng an toàn (~58% của canvas 108dp).
- Bản PNG vuông dự phòng cho launcher cũ; banner 320×180 cho Android TV.
```bash
python3 -m pip install --user Pillow
python3 make_icons.py
```

---

## 8. ⚠️ Các lỗi thực tế & cách khắc phục (phần quan trọng nhất)

### 8.1. Lỗi chứng chỉ: `Unacceptable certificate: CN=WE2`
Máy chiếu đời cũ có **kho CA hệ thống lỗi thời** → không nhận chứng chỉ mới của Google
(chuỗi `*.google.com → WE2 → GTS Root R4`). **Hai nguyên nhân, phải xử lý cả hai:**

1. **Sai ngày giờ trên máy chiếu** (rất hay gặp!). Nếu máy tưởng đang là 2016/1970 thì mọi
   chứng chỉ đều "chưa hiệu lực". → **Chỉnh đúng ngày giờ + múi giờ.** Dù bundle CA cũng vô
   ích nếu giờ sai.
2. **Thiếu root CA mới.** → Bundle sẵn root CA của Google vào app và khai báo tin tưởng:
   - Tải `https://i.pki.goog/r1.pem … r4.pem` vào `res/raw/gts_r1..r4.pem`.
   - `res/xml/network_security_config.xml`:
     ```xml
     <network-security-config>
       <base-config cleartextTrafficPermitted="false">
         <trust-anchors>
           <certificates src="system"/>
           <certificates src="@raw/gts_r1"/>
           <certificates src="@raw/gts_r2"/>
           <certificates src="@raw/gts_r3"/>
           <certificates src="@raw/gts_r4"/>
         </trust-anchors>
       </base-config>
     </network-security-config>
     ```
   - Khai báo trong manifest: `android:networkSecurityConfig="@xml/network_security_config"`.

### 8.2. Lỗi phát video: `Error 153 — Video player configuration error`
YouTube IFrame Player **từ chối origin `file://`** (origin là "null"). Phải phục vụ giao diện
qua **một origin https hợp lệ**. Cách làm (không cần thư viện): chặn request trong
`WebViewClient.shouldInterceptRequest`, trả nội dung từ assets cho một host ảo:
```java
private static final String APP_HOST = "appassets.androidplatform.net";
// load: https://appassets.androidplatform.net/index.html
@Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req){
    Uri u = req.getUrl();
    if (APP_HOST.equals(u.getHost())) {
        String asset = u.getPath().substring(1);            // "/index.html" -> "index.html"
        return new WebResourceResponse(guessMime(asset), "utf-8", getAssets().open(asset));
    }
    return null;
}
```
Đồng thời truyền `origin: window.location.origin` vào `playerVars`.

### 8.3. Màn hình đen / video quá nhỏ
- **Màn đen** xuất phát từ việc bật `setUseWideViewPort(true)` + `setLoadWithOverviewMode(true)`
  + `setInitialScale(0)` trên WebView máy chiếu cũ → tính sai tỉ lệ. **Gỡ bỏ các thiết lập này.**
- **Đầy màn hình đúng cách:** đọc **độ phân giải thật** ở native rồi ép kích thước, thay vì
  set cứng:
  ```java
  DisplayMetrics dm = new DisplayMetrics();
  getWindowManager().getDefaultDisplay().getRealMetrics(dm);
  webView.evaluateJavascript("window.applyScreen("+dm.widthPixels+","+dm.heightPixels+","+dm.density+")", null);
  ```
  Bên JS quy về CSS px (`px / density`), set kích thước `html/body/#player`, và gọi
  **`player.setSize(w, h)`** của YouTube để player phủ kín.

### 8.4. Bài học chung
- Phần tử HTML đè lên `<iframe>` video (nút Back, thanh điều khiển) **không** làm video đen —
  nên overlay/điều khiển tùy biến là an toàn.
- Tăng `versionCode` mỗi lần build để máy cập nhật đè bản cũ.
- Bản debug ký bằng khóa debug → cài sideload được, chỉ cần bật "nguồn không xác định".

---

## 9. Build & cài

```bash
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk     # hoặc copy APK rồi mở để cài
```
Đặt **link Sheet mặc định** ngay trong `app.js` (hằng `DEFAULT_SHEET_URL`) để lần đầu mở app
là chạy luôn, không phải gõ gì trên máy chiếu. Sau này quản lý video bằng cách **sửa Sheet
trên điện thoại** rồi bấm 🔄.

---

## 10. Đưa lên GitHub

```bash
brew install gh
gh auth login --hostname github.com --git-protocol https --web   # device flow, authorize qua trình duyệt
gh auth setup-git                                                 # để git dùng token của gh

git init -b main
# .gitignore: build/, .gradle/, local.properties, .idea/, *.iml, .DS_Store
git add -A && git commit -m "Initial commit"
# Nếu bị chặn email riêng tư (GH007): dùng email noreply
git config user.email "<id>+<user>@users.noreply.github.com"
git commit --amend --reset-author --no-edit
gh repo create AntubeKids --public --source=. --remote=origin --push
```

---

## Tổng kết các quyết định mấu chốt
1. WebView kiosk + assets — đơn giản, dễ sửa, không cần kiến thức Android UI sâu.
2. Sheet công khai + gviz CSV + htmlview để liệt kê tab → **không cần đăng nhập/API key**.
3. Tải dữ liệu ở native → tránh CORS.
4. Phục vụ UI qua origin https ảo → YouTube chịu phát (tránh Error 153).
5. Bundle root CA Google + nhắc chỉnh giờ → vượt lỗi chứng chỉ trên máy cũ.
6. Đọc độ phân giải thật + `player.setSize` → đầy màn hình mọi máy.

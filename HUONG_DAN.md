# Antube Kids — Hướng dẫn

App Android phát video YouTube cho bé trên máy chiếu ViewSonic PJ-9451 (loại smart, có cài app).
Danh sách video lấy từ **Google Sheet công khai** — không cần đăng nhập tài khoản nào.

---

## 1. Chuẩn bị Google Sheet

1. Tạo một Google Sheet mới.
2. Mỗi video một dòng:
   - **Cột A** = Tên video (hiện dưới hình)
   - **Cột B** = đường dẫn YouTube (dán cả link `https://www.youtube.com/watch?v=...` hoặc `https://youtu.be/...` đều được)

   | A (Tên)              | B (Link)                                   |
   |----------------------|--------------------------------------------|
   | Bài hát bảng chữ cái | https://www.youtube.com/watch?v=75p-N9YKqNo |
   | Đếm số 1–10          | https://youtu.be/DR-cfDsHCGA               |

   > Dòng tiêu đề (nếu có) sẽ tự bỏ qua. App tự nhận link YouTube ở bất kỳ cột nào.

3. Bấm **Chia sẻ** → **Bất kỳ ai có đường liên kết** → quyền **Người xem**.
4. Copy đường dẫn trên thanh địa chỉ (dạng `https://docs.google.com/spreadsheets/d/..../edit`).

Muốn thêm/bớt video sau này: chỉ cần sửa Sheet rồi bấm nút 🔄 trong app — **không cần cài lại app**.

---

## 2. Cài app vào máy chiếu

File APK nằm ở: `app/build/outputs/apk/debug/app-debug.apk`

Có 2 cách:

**Cách A — qua USB (adb), khi máy tính nối được với máy chiếu:**
```
adb connect <địa-chỉ-IP-máy-chiếu>     # nếu cài qua mạng
adb install -r "app/build/outputs/apk/debug/app-debug.apk"
```

**Cách B — copy file:**
1. Chép `app-debug.apk` vào USB.
2. Cắm USB vào máy chiếu, dùng trình quản lý file của máy chiếu mở file APK để cài.
3. Nếu máy báo chặn, bật **Cài đặt → Bảo mật → Cho phép cài từ nguồn không xác định**.

Sau khi cài, app tên **“Antube Kids”** sẽ xuất hiện ở màn hình ứng dụng / Android TV launcher.

---

## 3. Dùng lần đầu

1. Mở app. Lần đầu nó sẽ hỏi đường dẫn Sheet → **dán link Google Sheet** ở Bước 1 → bấm **Lưu & Tải**.
2. Lưới video hiện ra. Bé bấm (hoặc dùng remote) vào video muốn xem.

### Điều khiển
- **Cảm ứng / chuột:** bấm thẳng vào video.
- **Remote / bàn phím:** mũi tên ⬅️➡️⬆️⬇️ để chọn, **OK/Enter** để phát.
- Khi đang xem: dùng **thanh điều khiển của YouTube** (kéo thanh thời gian để tua). Bằng remote: **OK** phát/tạm dừng, **⬅️/➡️** tua 10 giây, **⬆️/⬇️** video trước/sau, **Back** về danh sách.
- Hết một video sẽ **tự phát video tiếp theo**.
- Nút **⚙️** (hoặc phím Menu trên remote) mở lại Cài đặt để đổi Sheet.
- Nút **🔄** tải lại danh sách sau khi bạn sửa Sheet.

---

## 4. Build lại APK (khi cần sửa code)

Yêu cầu: đã cài Android Studio (đã có sẵn JDK + SDK).

```
cd "KidsVideoPlayer"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleDebug
```

Hoặc mở thư mục `KidsVideoPlayer` bằng Android Studio → **Build → Build APK(s)**.

---

## Ghi chú kỹ thuật

- App là **WebView kiosk**: toàn bộ giao diện nằm trong `app/src/main/assets/` (index.html, app.js, style.css).
  Muốn chỉnh giao diện chỉ cần sửa các file này rồi build lại.
- Sheet được tải ở **tầng native** (Java `HttpURLConnection`) để tránh lỗi CORS của WebView.
- Phát video bằng **YouTube IFrame Player API** (`rel=0`, `modestbranding=1` để hạn chế gợi ý lung tung).
  Video bị tắt nhúng (embedding) sẽ tự động bị bỏ qua.
- Danh sách được **lưu cache** trên máy, nên mất mạng tạm thời vẫn xem được danh sách cũ.
- minSdk 26 (Android 8.0) — phù hợp đa số máy chiếu smart.

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

## 1b. Quản lý giờ xem (tuỳ chọn — sheet "Schedule")

Muốn bé chỉ xem theo khung giờ, thêm **một tab tên đúng `Schedule`** trong cùng file Google Sheet
(tab này tự ẩn, không hiện trong danh sách playlist). Mỗi dòng là một khung giờ được phép:

| A (Ngày)   | B (Bắt đầu) | C (Kết thúc) |
|------------|-------------|--------------|
| Daily      | 18:00       | 19:30        |
| Weekend    | 08:00       | 10:00        |
| Mon-Fri    | 17:00       | 18:00        |

- **Ngày** nhận: `Daily` (mỗi ngày), `Weekday` (T2–T6), `Weekend` (T7,CN), tên thứ tiếng Anh
  (`Mon`,`Tue`,`Wed`,`Thu`,`Fri`,`Sat`,`Sun`), khoảng (`Mon-Fri`), hoặc liệt kê (`Mon, Wed, Fri`).
- **Giờ**: dạng 24h `HH:MM` (vd `18:00`) hoặc có AM/PM (`6:00 pm`). Một ngày có thể có nhiều dòng.
- Ngoài giờ cho phép, app hiện *“It's out of watching time, see you at: …”* kèm thời điểm xem kế tiếp,
  và **không cho phát**. Đang xem mà hết giờ sẽ tự dừng.
- Trong giờ cho phép, góc dưới-phải hiện **thời gian còn lại** (vd *“watching will end in: 35 minutes”*).
- **Không có tab Schedule (hoặc tab rỗng/sai) → không giới hạn**, app chạy như bình thường.

> App **lấy giờ thật từ mạng** + đồng hồ đếm độc lập của Android, và **khoá múi giờ** lúc cài
> lần đầu → **đổi giờ HOẶC đổi múi giờ của máy chiếu đều KHÔNG qua mặt được lịch**.
>
> Muốn chắc chắn (hoặc đổi múi giờ), thêm 1 dòng trong tab **Schedule**: cột A ghi `TZ`,
> cột B ghi lệch giờ, ví dụ `+7` (Việt Nam). Dòng này do bố mẹ kiểm soát trên Google Sheet,
> bé không sửa được trên máy chiếu.
>
> | A | B |
> |----|----|
> | TZ | +7 |
> | Daily | 18:00 | 19:30 |
>
> *Nếu cài app lần đầu mà máy chiếu đang để sai múi giờ, hãy chỉnh máy về đúng múi giờ rồi
> thêm dòng `TZ` như trên (hoặc xoá dữ liệu app 1 lần để khoá lại).*

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

## 3a. Nhập link bằng điện thoại (qua Wi-Fi) — khỏi gõ remote

Trong ⚙️ Settings, bấm **📱 Enter link from phone (Wi-Fi)**:
1. Máy chiếu hiện một địa chỉ kiểu **`http://192.168.1.x:8080`**.
2. Trên điện thoại **cùng mạng Wi-Fi**, mở địa chỉ đó bằng trình duyệt.
3. Dán link Google Sheet → bấm **Send**. Máy chiếu tự lưu và tải lại danh sách.

> Server chỉ chạy khi mở mục này, bấm **Done** (hoặc Back) là tắt — không tốn tài nguyên khi xem.
> Nếu không kết nối được: kiểm tra điện thoại và máy chiếu **cùng một Wi-Fi**, và router không bật
> chế độ cách ly thiết bị (AP isolation).

---

## 3b. Tự cập nhật app (không cần chép đè file)

App tự kiểm tra bản mới trên GitHub mỗi khi mở. Khi có bản mới:
1. Hiện **dải thông báo màu xanh** ở màn hình chính → bấm vào (hoặc mở ⚙️ Cài đặt).
2. Bấm **Update now** → app tự tải APK rồi mở trình cài đặt.
3. Lần đầu, Android sẽ hỏi cấp quyền **"Cài đặt ứng dụng không xác định"** cho Antube Kids —
   bật lên, quay lại bấm Update lần nữa. Bấm **Cài đặt** ở hộp thoại là xong.

> Android không cho app cài ngoài tự cài hoàn toàn im lặng, nên luôn có 1 bước bấm xác nhận.

**Để phát hành bản mới (người quản lý):** sửa code → tăng `versionCode`/`versionName` trong
`app/build.gradle` → chạy `./release.sh "mô tả thay đổi"`. Máy của bé sẽ thấy bản mới ở lần
mở kế tiếp.

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

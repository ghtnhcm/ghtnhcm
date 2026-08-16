# GHTN HCM — Bản đồ khảo sát Củ Chi (bản chuyển sang Cloudflare Pages, JS thuần)

> Bản này dùng JavaScript thuần (không có file `.ts`) để có thể **kéo-thả (drag &
> drop) trực tiếp trên Cloudflare Pages Dashboard** — mục "Upload and deploy" của
> Cloudflare không hỗ trợ file TypeScript. Nếu bạn muốn dùng TypeScript, dùng bản
> `wrangler pages deploy .` với các file `.ts` thay vì kéo-thả trên dashboard.

Dự án gốc được viết cho Netlify (Netlify Functions + Netlify DB). Bản này đã được
chuyển đổi để chạy trên **Cloudflare Pages**:

- `index.html` — giao diện bản đồ (không đổi so với bản gốc)
- `functions/api/locations.ts` — Cloudflare Pages Function thay thế cho Netlify
  Function, xử lý `GET / POST / DELETE /api/locations`
- `db/` — schema Drizzle ORM, dùng driver `@neondatabase/serverless` (chạy được
  trên Cloudflare Workers runtime, khác với driver `netlify-db` chỉ chạy trên Netlify)
- `migrations/0000_init.sql` — SQL tạo 2 bảng `live_locations` và `location_history`

## Vì sao cần đổi database

Netlify DB là dịch vụ Postgres (Neon) được Netlify tự động cấp phát và gắn biến
môi trường sẵn — nó **không khả dụng khi deploy trên Cloudflare**. Bạn cần tự tạo
một database Postgres và cấu hình biến môi trường `DATABASE_URL`. Cách đơn giản
nhất là dùng [Neon](https://neon.tech) (free tier, tương thích 100% vì code đã
dùng driver `@neondatabase/serverless`).

## Các bước deploy

### 1. Tạo database Postgres (Neon)
1. Vào https://neon.tech, tạo project mới (chọn region gần VN, ví dụ Singapore).
2. Copy connection string dạng `postgresql://user:pass@host/dbname?sslmode=require`.
3. Tạo bảng: mở **SQL Editor** trên trang Neon, dán nguyên nội dung file
   `migrations/0000_init.sql`, bấm Run.

### 2. Deploy lên Cloudflare Pages

**Cách A — Kéo-thả trên Dashboard (đúng màn hình bạn đang thấy):**
1. Ở màn hình "Upload and deploy", xoá hết các file cũ (nếu có, bấm "Remove all").
2. Kéo-thả **toàn bộ nội dung bên trong** thư mục giải nén này (không kéo cả thư
   mục cha) — tức là kéo `index.html`, `functions/`, `db/`, `migrations/`,
   `package.json`, `README.md`, `.gitignore` — vào khung upload. Lúc này sẽ
   không còn cảnh báo file TypeScript nữa vì bản này toàn bộ là `.js`.
3. Bấm **Deploy**.
4. Sau khi deploy xong, vào project vừa tạo → Settings → Environment variables,
   thêm `DATABASE_URL` = connection string Neon ở bước 1 (thêm cho cả
   Production và Preview), rồi bấm **Retry deployment** để function nhận được
   biến môi trường.

**Cách B — qua Git (khuyên dùng nếu cần cập nhật code thường xuyên):**
1. Đẩy toàn bộ thư mục này lên một repo GitHub/GitLab.
2. Vào Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Chọn repo, để trống Build command (không cần build), Build output directory
   để `/` (thư mục gốc).
4. Vào Settings → Environment variables, thêm `DATABASE_URL` = connection string
   Neon ở bước 1 (thêm cho cả Production và Preview).
5. Deploy.

**Cách C — Direct Upload qua CLI (không cần Git):**
```bash
npm install -g wrangler
wrangler pages deploy . --project-name=ghtn-hcm
```
Sau đó vào Dashboard → project vừa tạo → Settings → Environment variables để
thêm `DATABASE_URL`, rồi deploy lại (`wrangler pages deploy .`) để function
nhận được biến môi trường.

### 3. Kiểm tra
Mở trang đã deploy, bật chia sẻ vị trí trên 1 thiết bị, kiểm tra endpoint
`/api/locations` trả về JSON danh sách vị trí.

## Lưu ý
- Toàn bộ logic nghiệp vụ (validate dữ liệu, giới hạn độ dài tên/id, thời gian
  lưu trữ lịch sử di chuyển 24h, ngưỡng "offline" sau 90s không cập nhật) được
  giữ nguyên 100% so với bản Netlify gốc.
- Vị trí của người dùng được lưu và hiển thị cho những người khác trong nhóm —
  hãy đảm bảo mọi thành viên đều biết và đồng ý việc chia sẻ vị trí này.

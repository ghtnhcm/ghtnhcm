# GHTN HCM — Bản đồ khảo sát Củ Chi (bản Cloudflare Pages + D1, JS thuần)

> Bản này dùng **Cloudflare D1** (SQLite chạy trên hạ tầng Cloudflare) thay cho
> Postgres/Neon — vì D1 **miễn phí, không tính phí truyền dữ liệu (egress)**,
> nên sẽ không còn bị khóa giữa chừng như khi dùng Neon free tier.
> Vẫn là JavaScript thuần (không `.ts`) để kéo-thả trực tiếp trên Cloudflare
> Pages Dashboard được.

## Vì sao đổi sang D1

- Neon free tier giới hạn 5GB data transfer/tháng, hết là bị khóa compute.
- D1 free tier: không tính phí egress, ~150 triệu lượt đọc + ~3 triệu lượt
  ghi/tháng, 5GB lưu trữ — rộng rãi hơn nhiều cho app này.
- D1 chạy cùng hạ tầng Cloudflare Workers → nhanh hơn, không cần biến môi
  trường `DATABASE_URL`, không cần tài khoản Neon nữa.
- Đánh đổi: phải tạo D1 database mới và **chuyển thủ công dữ liệu cũ** từ
  Neon sang (xem bước 3 bên dưới) — D1 không tự đồng bộ với Neon.

## Các bước deploy

### 1. Tạo D1 database

```bash
npm install -g wrangler
wrangler login
wrangler d1 create ghtnhcm
```

Lệnh trên in ra một khối cấu hình có `database_id` — copy giá trị đó vào
`wrangler.toml`, thay cho `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 2. Chạy migration để tạo bảng

```bash
wrangler d1 migrations apply ghtnhcm --remote
```

(Dùng `--local` nếu muốn test trên máy trước bằng `wrangler pages dev .`)

### 3. (Tuỳ chọn) Chuyển dữ liệu cũ từ Neon sang D1

Nếu bạn còn dữ liệu cũ trong Neon muốn giữ lại:

1. Vào Neon SQL Editor, chạy lệnh export từng bảng ra CSV, ví dụ:
   ```sql
   SELECT * FROM live_locations;
   ```
   rồi bấm nút tải xuống CSV/kết quả (Neon console có nút export kết quả).
2. Chuyển từng dòng CSV thành câu lệnh `INSERT INTO ...` (có thể nhờ Claude
   convert giúp nếu bạn dán nội dung CSV vào chat) — lưu ý các cột thời gian
   (`updated_at`, `recorded_at`, `created_at`...) cần đổi từ định dạng
   timestamp Postgres sang **số giây Unix** (D1 lưu thời gian dạng số).
3. Chạy các câu `INSERT` đó bằng:
   ```bash
   wrangler d1 execute ghtnhcm --remote --file=./seed.sql
   ```

Nếu không cần giữ dữ liệu cũ (bắt đầu lại từ đầu), bỏ qua bước này.

### 4. Deploy lên Cloudflare Pages

**Cách A — Kéo-thả trên Dashboard:**
1. Ở màn hình "Upload and deploy", xoá hết file cũ (nếu có).
2. Kéo-thả toàn bộ nội dung bên trong thư mục này (`index.html`,
   `functions/`, `db/`, `migrations/`, `package.json`, `wrangler.toml`,
   `README.md`, `.gitignore`) vào khung upload.
3. Bấm **Deploy**.
4. Vào project vừa tạo → Settings → Bindings → thêm **D1 database binding**:
   Variable name = `DB`, chọn database `ghtnhcm` vừa tạo ở bước 1. (Kéo-thả
   qua Dashboard không tự đọc `wrangler.toml`, nên bước gắn binding này phải
   làm thủ công trên Dashboard.)
5. Bấm **Retry deployment**.

**Cách B — qua CLI (khuyên dùng, đọc thẳng `wrangler.toml`):**
```bash
wrangler pages deploy . --project-name=ghtn-hcm
```

### 5. Kiểm tra
Mở trang đã deploy, bật chia sẻ vị trí trên 1 thiết bị, kiểm tra endpoint
`/api/locations` trả về JSON danh sách vị trí.

## Lưu ý
- Toàn bộ logic nghiệp vụ (validate dữ liệu, giới hạn độ dài tên/id, thời
  gian lưu trữ lịch sử di chuyển, ngưỡng "offline" sau 90s không cập nhật)
  được giữ nguyên 100% so với bản Neon/Postgres.
- Vị trí của người dùng được lưu và hiển thị cho những người khác trong
  nhóm — hãy đảm bảo mọi thành viên đều biết và đồng ý việc chia sẻ vị trí
  này.
- Biến môi trường bí mật `ADMIN_KEY` (dùng để xoá dữ liệu hàng loạt) vẫn cần
  cấu hình lại ở Settings → Environment variables như bản cũ.

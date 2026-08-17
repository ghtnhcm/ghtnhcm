-- "status" đổi ý nghĩa từ trạng thái phễu (chưa gặp/đã gặp/...) sang loại
-- ứng viên (khong_tiem_nang / ung_vien_a / ung_vien_b / ung_vien_c). Các mối
-- cũ còn mang mã trạng thái cũ được gán tạm về "khong_tiem_nang" để không vỡ
-- ràng buộc NOT NULL / hiển thị nhãn lỗi; có thể cập nhật lại thủ công sau.
UPDATE "leads" SET "status" = 'khong_tiem_nang'
  WHERE "status" NOT IN ('khong_tiem_nang', 'ung_vien_a', 'ung_vien_b', 'ung_vien_c');

-- Lưu ý: SQLite không hỗ trợ ALTER COLUMN ... SET DEFAULT như Postgres, nên
-- bỏ bước đổi default ở đây — logic mặc định 'khong_tiem_nang' đã được xử lý
-- ở tầng ứng dụng (functions/api/leads.js) khi tạo mối mới, nên không ảnh hưởng.

-- Phần đánh giá 10 tiêu chí: đáp án từng câu (0/1) lưu dạng JSON text, tổng
-- điểm, và kết quả ("dat" khi đủ 10/10, "chua_dat" khi chưa đủ).
ALTER TABLE "leads" ADD COLUMN "eval_answers" text;
ALTER TABLE "leads" ADD COLUMN "eval_score" integer;
ALTER TABLE "leads" ADD COLUMN "eval_result" text;

-- Video Studio: lưu NLE timeline (JSON). SQLite không có ADD COLUMN IF NOT EXISTS;
-- selfHealDb.ts tự kiểm tra rồi thêm cột. Chạy tay file này chỉ khi cột chưa tồn tại.
ALTER TABLE videos ADD COLUMN timeline TEXT;

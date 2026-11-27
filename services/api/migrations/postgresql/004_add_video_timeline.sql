-- Video Studio: lưu NLE timeline (JSON) làm căn cứ dựng video. Đồng bộ prisma migration 20261126100000.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS timeline TEXT;

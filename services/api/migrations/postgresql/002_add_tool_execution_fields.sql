-- AI-OPC Company OS — Thêm trường thực thi tool vào decision_packages
-- (tương ứng prisma migration 20260914133007_add_tool_execution_fields:
--  "params_json" TEXT + "tool_id" TEXT).
-- Khuyến nghị dùng `pnpm db:migrate` (Prisma) thay vì chạy tay file này.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE decision_packages
  ADD COLUMN IF NOT EXISTS tool_id VARCHAR(50) REFERENCES tools(id);
ALTER TABLE decision_packages
  ADD COLUMN IF NOT EXISTS params_json TEXT;

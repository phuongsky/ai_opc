-- AI-OPC Company OS — Thêm cột thực thi tool vào decision_packages.
-- Nhánh offline (3-engine) đồng bộ với prisma migration
-- 20260914133007_add_tool_execution_fields (2 ALTER: params_json, tool_id).
-- Idempotent: chỉ thêm cột khi chưa tồn tại (SQLite không có ADD COLUMN IF NOT EXISTS).

ALTER TABLE decision_packages ADD COLUMN tool_id VARCHAR(50);
ALTER TABLE decision_packages ADD COLUMN params_json TEXT;

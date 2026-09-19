-- AI-OPC Company OS — Thêm trường thực thi tool vào decision_packages
-- (tương ứng prisma migration 20260914133007_add_tool_execution_fields:
--  "params_json" TEXT + "tool_id" TEXT).
-- Khuyến nghị dùng `pnpm db:migrate:mssql` (Prisma) thay vì chạy tay file này.
-- Idempotent: kiểm tra sys.columns trước khi thêm (T-SQL không có
-- ADD COLUMN IF NOT EXISTS). Text theo quy ước nhà engine: NVARCHAR(MAX).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'decision_packages') AND name = N'tool_id'
)
ALTER TABLE decision_packages ADD tool_id VARCHAR(50) NULL REFERENCES tools(id);

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'decision_packages') AND name = N'params_json'
)
ALTER TABLE decision_packages ADD params_json NVARCHAR(MAX) NULL;

-- AI-OPC Company OS — Thêm cột thực thi tool vào decision_packages.
-- Nhánh offline (3-engine) đồng bộ với prisma migration
-- 20260914133007_add_tool_execution_fields (2 ALTER: params_json, tool_id).
-- Idempotent: guard trên sys.columns (T-SQL không có ADD COLUMN IF NOT EXISTS).

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'decision_packages') AND name = N'tool_id'
)
ALTER TABLE decision_packages ADD tool_id VARCHAR(50) NULL;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'decision_packages') AND name = N'params_json'
)
ALTER TABLE decision_packages ADD params_json NVARCHAR(MAX) NULL;

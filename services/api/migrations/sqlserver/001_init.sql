-- AI-OPC Company OS — Initial schema (Microsoft SQL Server)
-- Khuyến nghị dùng `pnpm db:migrate:mssql` (Prisma) thay vì chạy tay file này.

CREATE TABLE departments (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  manager_agent_id VARCHAR(50)
);

CREATE TABLE agents (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(100) NOT NULL,
  department_id VARCHAR(50) NULL REFERENCES departments(id),
  reports_to VARCHAR(50),
  mission NVARCHAR(MAX) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'READY',
  autonomy_level INT NOT NULL DEFAULT 1,
  monthly_cost_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE tools (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description NVARCHAR(MAX),
  risk_level VARCHAR(10) NOT NULL DEFAULT 'R1',
  requires_approval BIT NOT NULL DEFAULT 0
);

CREATE TABLE agent_tool_permissions (
  agent_id VARCHAR(50) REFERENCES agents(id),
  tool_id VARCHAR(50) REFERENCES tools(id),
  permission_level VARCHAR(10) NOT NULL,
  PRIMARY KEY (agent_id, tool_id)
);

CREATE TABLE tasks (
  id VARCHAR(50) PRIMARY KEY,
  parent_task_id VARCHAR(50),
  title VARCHAR(255) NOT NULL,
  objective NVARCHAR(MAX) NOT NULL,
  assigned_to VARCHAR(50) NULL REFERENCES agents(id),
  status VARCHAR(30) NOT NULL DEFAULT 'NEW',
  risk_level VARCHAR(10) NOT NULL DEFAULT 'R1',
  created_by VARCHAR(50) NOT NULL DEFAULT 'FOUNDER',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  completed_at DATETIME2 NULL
);

CREATE TABLE decision_packages (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) NULL REFERENCES tasks(id),
  agent_id VARCHAR(50) NULL REFERENCES agents(id),
  decision_title VARCHAR(255) NOT NULL,
  reason NVARCHAR(MAX) NOT NULL,
  evidence NVARCHAR(MAX),
  risk_level VARCHAR(10) NOT NULL,
  ai_recommendation NVARCHAR(MAX),
  confidence_score DECIMAL(5,2),
  options_json NVARCHAR(MAX),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  decided_at DATETIME2 NULL
);

CREATE TABLE audit_logs (
  id INT IDENTITY(1,1) PRIMARY KEY,
  agent_id VARCHAR(50),
  task_id VARCHAR(50),
  tool_id VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  input_payload NVARCHAR(MAX),
  result_summary NVARCHAR(MAX),
  risk_level VARCHAR(10),
  timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Bảo vệ tính bất biến của audit_logs (khuyến nghị production):
-- DENY UPDATE, DELETE ON audit_logs TO app_user;

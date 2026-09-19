-- SQLite tương thích VARCHAR/TEXT/INTEGER/REAL, không cần khai báo độ dài.
-- AI-OPC Company OS — Initial schema (PostgreSQL)
-- Khuyến nghị dùng `pnpm db:migrate` (Prisma) thay vì chạy tay file này.
-- File này giữ lại để tham chiếu / import vào công cụ DB khác nếu cần.

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  manager_agent_id VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  title VARCHAR(100) NOT NULL,
  department_id VARCHAR(50) REFERENCES departments(id),
  reports_to VARCHAR(50),
  mission TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'READY',
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  monthly_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tools (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  risk_level VARCHAR(10) NOT NULL DEFAULT 'R1',
  requires_approval INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_tool_permissions (
  agent_id VARCHAR(50) REFERENCES agents(id),
  tool_id VARCHAR(50) REFERENCES tools(id),
  permission_level VARCHAR(10) NOT NULL,
  PRIMARY KEY (agent_id, tool_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(50) PRIMARY KEY,
  parent_task_id VARCHAR(50),
  title VARCHAR(255) NOT NULL,
  objective TEXT NOT NULL,
  assigned_to VARCHAR(50) REFERENCES agents(id),
  status VARCHAR(30) NOT NULL DEFAULT 'NEW',
  risk_level VARCHAR(10) NOT NULL DEFAULT 'R1',
  created_by VARCHAR(50) NOT NULL DEFAULT 'FOUNDER',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS decision_packages (
  id VARCHAR(50) PRIMARY KEY,
  task_id VARCHAR(50) REFERENCES tasks(id),
  agent_id VARCHAR(50) REFERENCES agents(id),
  decision_title VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT,
  risk_level VARCHAR(10) NOT NULL,
  ai_recommendation TEXT,
  confidence_score REAL,
  options_json TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id VARCHAR(50),
  task_id VARCHAR(50),
  tool_id VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  input_payload TEXT,
  result_summary TEXT,
  risk_level VARCHAR(10),
  timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SQLite không hỗ trợ REVOKE cấp bảng; kiểm soát ghi audit_logs ở tầng ứng dụng (services/api/src/modules/audit).

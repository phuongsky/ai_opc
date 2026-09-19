-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "manager_agent_id" TEXT
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department_id" TEXT,
    "reports_to" TEXT,
    "mission" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "autonomy_level" INTEGER NOT NULL DEFAULT 1,
    "monthly_cost_usd" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tools" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "risk_level" TEXT NOT NULL DEFAULT 'R1',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "agent_tool_permissions" (
    "agent_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "permission_level" TEXT NOT NULL,

    PRIMARY KEY ("agent_id", "tool_id"),
    CONSTRAINT "agent_tool_permissions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "agent_tool_permissions_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tools" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parent_task_id" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "assigned_to" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "risk_level" TEXT NOT NULL DEFAULT 'R1',
    "created_by" TEXT NOT NULL DEFAULT 'FOUNDER',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" DATETIME,
    CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "decision_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT,
    "agent_id" TEXT,
    "decision_title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "risk_level" TEXT NOT NULL,
    "ai_recommendation" TEXT,
    "confidence_score" REAL,
    "options_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_at" DATETIME,
    CONSTRAINT "decision_packages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "decision_packages_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agent_id" TEXT,
    "task_id" TEXT,
    "tool_id" TEXT,
    "action" TEXT NOT NULL,
    "input_payload" TEXT,
    "result_summary" TEXT,
    "risk_level" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

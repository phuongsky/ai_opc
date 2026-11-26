-- AI-OPC Company OS — Bảng videos cho Agent quản lý video (agent_create_video_ai).
-- Idempotent (CREATE ... IF NOT EXISTS). selfHealDb.ts cũng tự tạo bảng này cho DB desktop cũ.
CREATE TABLE IF NOT EXISTS videos (
  id VARCHAR(50) PRIMARY KEY,
  title TEXT NOT NULL,
  brief TEXT,
  script TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'IDEA',
  platform VARCHAR(30),
  aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
  duration_sec INTEGER,
  tags TEXT,
  asset_url TEXT,
  thumbnail_url TEXT,
  provider VARCHAR(50),
  provider_job_id VARCHAR(200),
  published_url TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  notes TEXT,
  agent_id VARCHAR(50) NOT NULL DEFAULT 'agent_create_video_ai',
  task_id VARCHAR(50),
  created_by VARCHAR(50) NOT NULL DEFAULT 'AGENT',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);
CREATE INDEX IF NOT EXISTS videos_status_idx ON videos(status);

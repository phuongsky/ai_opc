-- AI-OPC Company OS — Bảng videos cho Agent quản lý video (agent_create_video_ai).
IF OBJECT_ID('videos', 'U') IS NULL
BEGIN
  CREATE TABLE videos (
    id VARCHAR(50) PRIMARY KEY,
    title NVARCHAR(MAX) NOT NULL,
    brief NVARCHAR(MAX),
    script NVARCHAR(MAX),
    status VARCHAR(20) NOT NULL DEFAULT 'IDEA',
    platform VARCHAR(30),
    aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
    duration_sec INT,
    tags NVARCHAR(MAX),
    asset_url NVARCHAR(MAX),
    thumbnail_url NVARCHAR(MAX),
    provider VARCHAR(50),
    provider_job_id VARCHAR(200),
    published_url NVARCHAR(MAX),
    cost_usd FLOAT NOT NULL DEFAULT 0,
    notes NVARCHAR(MAX),
    agent_id VARCHAR(50) NOT NULL DEFAULT 'agent_create_video_ai',
    task_id VARCHAR(50),
    created_by VARCHAR(50) NOT NULL DEFAULT 'AGENT',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    published_at DATETIME2
  );
  CREATE INDEX videos_status_idx ON videos(status);
END

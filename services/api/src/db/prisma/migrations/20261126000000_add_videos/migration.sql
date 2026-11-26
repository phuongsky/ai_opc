-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT,
    "script" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDEA',
    "platform" TEXT,
    "aspect_ratio" TEXT NOT NULL DEFAULT '16:9',
    "duration_sec" INTEGER,
    "tags" TEXT,
    "asset_url" TEXT,
    "thumbnail_url" TEXT,
    "provider" TEXT,
    "provider_job_id" TEXT,
    "published_url" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "agent_id" TEXT NOT NULL DEFAULT 'agent_create_video_ai',
    "task_id" TEXT,
    "created_by" TEXT NOT NULL DEFAULT 'AGENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "videos_status_idx" ON "videos"("status");

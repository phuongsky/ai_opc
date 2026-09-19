-- CreateTable
CREATE TABLE "founders" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'founder_1',
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "founders_email_key" ON "founders"("email");

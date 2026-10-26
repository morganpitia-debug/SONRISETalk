ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "user_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterUserId" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_reports_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "user_reports_status_createdAt_idx" ON "user_reports"("status", "createdAt");
CREATE INDEX "user_reports_reportedUserId_createdAt_idx" ON "user_reports"("reportedUserId", "createdAt");

CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "admin_audit_logs_actorUserId_createdAt_idx" ON "admin_audit_logs"("actorUserId", "createdAt");
CREATE INDEX "admin_audit_logs_targetUserId_createdAt_idx" ON "admin_audit_logs"("targetUserId", "createdAt");

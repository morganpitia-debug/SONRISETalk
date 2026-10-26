CREATE TABLE "story_mutes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mutedUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_mutes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_mutes_mutedUserId_fkey" FOREIGN KEY ("mutedUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_mutes_userId_mutedUserId_key" ON "story_mutes"("userId", "mutedUserId");
CREATE INDEX "story_mutes_mutedUserId_createdAt_idx" ON "story_mutes"("mutedUserId", "createdAt");

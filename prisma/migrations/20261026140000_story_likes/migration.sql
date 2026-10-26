CREATE TABLE "story_likes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "story_likes_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "story_likes_storyId_userId_key" ON "story_likes"("storyId", "userId");
CREATE INDEX "story_likes_userId_createdAt_idx" ON "story_likes"("userId", "createdAt");

CREATE TABLE "highlights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverUrl" TEXT NOT NULL,
    "coverType" TEXT NOT NULL DEFAULT 'image',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "highlights_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "highlight_stories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "highlightId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "highlight_stories_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "highlights" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "highlight_stories_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "stories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "highlights_ownerId_displayOrder_idx" ON "highlights"("ownerId", "displayOrder");
CREATE UNIQUE INDEX "highlight_stories_highlightId_storyId_key" ON "highlight_stories"("highlightId", "storyId");
CREATE UNIQUE INDEX "highlight_stories_highlightId_position_key" ON "highlight_stories"("highlightId", "position");
CREATE INDEX "highlight_stories_storyId_idx" ON "highlight_stories"("storyId");

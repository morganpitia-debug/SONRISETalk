ALTER TABLE "conversation_members" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "user_settings" ADD COLUMN "allowNicknamesFrom" TEXT NOT NULL DEFAULT 'everyone';

CREATE TABLE "conversation_nicknames" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "setterUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "conversation_nicknames_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_nicknames_setterUserId_fkey" FOREIGN KEY ("setterUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_nicknames_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "conversation_nicknames_conversationId_setterUserId_targetUserId_key"
ON "conversation_nicknames"("conversationId", "setterUserId", "targetUserId");

CREATE INDEX "conversation_nicknames_targetUserId_idx"
ON "conversation_nicknames"("targetUserId");

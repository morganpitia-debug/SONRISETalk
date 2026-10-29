CREATE TABLE "call_participants" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socketId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "call_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_participants_callId_userId_key" ON "call_participants"("callId", "userId");
CREATE INDEX "call_participants_userId_leftAt_idx" ON "call_participants"("userId", "leftAt");

ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_participants" ADD CONSTRAINT "call_participants_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "call_invitations" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "call_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_invitations_call_id_user_id_key" ON "call_invitations"("call_id", "user_id");
CREATE INDEX "call_invitations_user_id_status_idx" ON "call_invitations"("user_id", "status");

ALTER TABLE "call_invitations" ADD CONSTRAINT "call_invitations_call_id_fkey"
FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_invitations" ADD CONSTRAINT "call_invitations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_invitations" ADD CONSTRAINT "call_invitations_invited_by_id_fkey"
FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

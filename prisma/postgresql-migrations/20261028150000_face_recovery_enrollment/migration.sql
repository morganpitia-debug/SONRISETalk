CREATE TABLE "face_recovery_enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "encrypted_reference" BYTEA NOT NULL,
    "initialization_vector" BYTEA NOT NULL,
    "authentication_tag" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "face_recovery_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "face_recovery_enrollments_user_id_key" ON "face_recovery_enrollments"("user_id");

ALTER TABLE "face_recovery_enrollments"
ADD CONSTRAINT "face_recovery_enrollments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

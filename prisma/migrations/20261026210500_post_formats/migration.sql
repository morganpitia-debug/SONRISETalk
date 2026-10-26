ALTER TABLE "posts" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'Post';

UPDATE "posts"
SET "format" = 'Reel'
WHERE EXISTS (
    SELECT 1
    FROM "post_media"
    WHERE "post_media"."postId" = "posts"."id"
      AND "post_media"."mediaType" = 'video'
);

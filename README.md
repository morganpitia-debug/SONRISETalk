# SONRISETALK 2.0

SONRISETALK includes Home, Discover, Create, Profile, Messages, Notifications, Settings, and SONRISE AI experiences.

## Underwater interface

Settings > Appearance lets you choose between the original default background and an underwater scene with white fish, plus the existing dark or light color scheme. The base environment, fish animation, and interactive foreground are separate stacking layers; fish ignore pointer input and stay clipped to the viewport. Fish movement respects reduced-motion preferences, and Home's text-post panels use opaque backgrounds for readability.

## Sign in and local development

The app requires login or signup; guest preview is not available. For local accounts and server-backed social data, configure `VITE_API_URL` in `.env.local` and use the login or signup flow. Backend failures are shown as errors rather than replaced with sample content. Start with `.env.example` as a reference; `.env.local` is ignored by Git. Keep provider credentials out of `VITE_*` variables because Vite exposes those values to browser code.

## SQLite and Prisma

Prisma stores data in `project.db` in the project root. The checked-in migration creates the complete current schema. Initialize it with:

```sh
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:check
```

`db:migrate` applies the checked-in migrations to the configured database; it does not reset or delete data. `db:check` tests that Prisma can connect to the SQLite file.

The database provider is SQLite, using Prisma 7's `better-sqlite3` driver adapter. The generated Prisma client is kept under the ignored `generated/` directory, and `npm run build` regenerates it before compiling the app. The prior migrations were PostgreSQL-specific and have been replaced for new SQLite setups. Existing PostgreSQL database contents are not copied automatically.

## Cloudinary media

Cloudinary credentials are read from the server-only `CLOUDINARY_URL` or the `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` entries in `.env.local`; never use `VITE_CLOUDINARY_*`. Authenticated uploads go through `/api/media/upload`, which streams accepted images and videos to the account folder and records Cloudinary URLs/asset IDs in posts and stories. The API enforces file type/size limits and tags uploads under the signed-in account's folder.

Chat supports attached JPG, PNG, WebP, and GIF images up to 10 MB. Images are uploaded to the sender's Cloudinary account folder, shown in the conversation, and can be opened full-size by clicking them. Apply the message-image migration with `npm run db:migrate` and restart the API after upgrading.

Cloudinary voice-note playback uses authenticated MP3-only delivery so recordings made in WebM can play reliably in browser audio players. A conversation-member-only endpoint can generate a fresh playback link for both the sender and recipients.

Senders can delete their own message for everyone in the conversation. The deletion is persisted and synchronized to the sender's and recipients' connected devices.

Stories expire 24 hours after creation. In the story viewer, the options menu lets you mute another account's stories or delete your own; the API only permits the story owner to delete it. Muted accounts' stories stay hidden for that signed-in account.

## Calls and voice notes

One-to-one voice and video calls use WebRTC for media and authenticated Socket.IO events for invitations, negotiation, and call-state updates. Browsers request microphone or camera access only after the user starts or answers a call. Configure `STUN_URLS` and a production `TURN_URLS` plus server-only `TURN_SHARED_SECRET` for reliable connections across restrictive networks; TURN credentials are short-lived and are returned only to authenticated users. Production deployments must use HTTPS and secure WebSockets. Group calls are not enabled.

Voice notes are recorded with `MediaRecorder`, limited to 20 MB, checked against supported audio signatures, and uploaded as authenticated Cloudinary assets. Playback is proxied through an authenticated API endpoint that verifies conversation membership on every request; the audio bytes are not stored in SQLite or exposed through long-lived Cloudinary URLs. Configure Cloudinary before sending voice notes. Call records and outcomes are stored in SQLite and available from the authenticated call-history API.

## Admin access

Admin promotion is disabled until the server operator configures `ADMIN_PROMOTION_PASSWORD_HASH`. Generate a scrypt hash with `npm run admin:hash`, put the hash in the server-only `.env.local`, and restart the API. Use a unique passphrase of at least 16 characters, keep it private, and never commit the hash or give the passphrase to regular users; anyone who knows it can promote their own account. Admin actions are checked against the database role on every request. Admins can review reports, inspect account profiles and recent posts, and delete non-admin accounts after confirmation. The app does not allow admins to sign in as, or impersonate, another user. Account deletion and other admin actions are recorded in an audit log.

Run automated checks with `npm test`. Build and database checks remain `npm run build`, `npm run db:validate`, and `npm run db:check`. Local automated tests do not replace two-user device testing; real microphone/camera access, Cloudinary delivery, and cross-network TURN connectivity require configured services and devices.

## Run the app with its API

`npm run dev` starts the API, applies pending SQLite migrations, and starts Vite. Open `http://localhost:5173`. The login and signup flows create local SQLite-backed accounts and issue an API session. Select "Save login on this device" to add the account to the device's Switch account list; choose "Add account" there to sign in with another account. Media uploads can be up to 100 MB and must be JPEG, PNG, WebP, GIF, MP4, WebM, or QuickTime. SONRISE AI accepts up to four images (JPEG, PNG, WebP, HEIC, HEIF), PDFs, or TXT/MD/CSV files per message, up to 3 MB each and 12 MB per request. Each request includes the four most recent attachments in the rolling conversation history. AI attachments are sent to Gemini for analysis and are not stored by the app. API secrets are used only by the server. SONRISE AI uses the server-side `GEMINI_API_KEY` through a rate-limited API endpoint. Restart the API after adding or changing the key.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.
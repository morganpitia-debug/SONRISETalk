# SONRISETALK 2.0

SONRISETALK includes Home, Discover, Create, Profile, Messages, Notifications, Settings, and SONRISE AI experiences.

## Underwater interface

Settings > Appearance lets you choose between the original default background and an underwater scene with white fish, plus the existing dark or light color scheme. The base environment, fish animation, and interactive foreground are separate stacking layers; fish ignore pointer input and stay clipped to the viewport. Fish movement respects reduced-motion preferences, and Home's text-post panels use opaque backgrounds for readability.

## Sign in and local development

The app requires login or signup; guest preview is not available. Run `npm run dev` to start the frontend and API together. In development, API requests and Socket.IO are proxied to the local API by default, so server-backed accounts, messaging, social features, and notifications work without setting `VITE_API_URL`. Set `VITE_API_URL` in `.env.local` only when connecting the frontend to an API at a different origin. Backend failures are shown as errors rather than replaced with sample content. Start with `.env.example` as a reference; `.env.local` is ignored by Git. Keep provider credentials out of `VITE_*` variables because Vite exposes those values to browser code.

Settings > Security includes password changes, recent sign-in history, and active-device session revocation. Sign-in records store the browser's user-agent string for a device label; the app does not collect IP addresses for this view. Password changes preserve the current session and revoke other active sessions.

## PostgreSQL and Prisma

The API uses PostgreSQL through Prisma's `pg` driver adapter. Set `DATABASE_URL` to the PostgreSQL connection string supplied by your database provider, both locally and in production. Do not commit credentials. Generate and apply the checked-in migrations with:

```sh
npm run db:generate
npm run db:validate
npm run db:migrate
npm run db:check
```

`db:migrate` applies pending migrations to the configured database; it does not reset or delete data. `db:check` verifies PostgreSQL connectivity. The generated Prisma client is kept under the ignored `generated/` directory, and `npm run build` regenerates it before compiling the app.

## Password recovery with passkeys

Forgot password opens a recovery page that does not ask for an account identifier. The user proves account ownership with a previously registered passkey, confirms the profile shown after verification, and then chooses a new password. The biometric itself stays on the user's device; the server verifies the passkey's cryptographic response. Depending on the device, the prompt may use Face ID, Windows Hello, a fingerprint, or the device PIN.

Users must set up a passkey while signed in before this recovery method can work. The app offers setup after signup and login. Existing accounts must sign in once and register a passkey. Passkeys are device/provider credentials: users should enroll another device or another authenticator when available so they do not lose access if one device is lost.

For local development, the allowed origins default to `CLIENT_ORIGINS`. In production, set the server-only `WEBAUTHN_ORIGINS` to the exact HTTPS origin(s) that serve the app, comma-separated, for example `https://sonrisetalk.example.com`. Do not include a path or trailing slash. Passkeys require HTTPS except on localhost.

## Render deployment

Deploy one Render Web Service to serve both the API and the built frontend. Create the managed PostgreSQL database in the same region as this service. Use branch `main`, build command `npm ci --include=dev && npm run build`, start command `npm start`, and health check path `/api/health`. Add `DATABASE_URL` to the **Web Service's Environment settings**, using the PostgreSQL database's **Internal Database URL**. A URL configured only on the database service is not automatically available to the Web Service; copy it to the Web Service or link the database to it. The start command applies pending PostgreSQL migrations before launching the server. No persistent disk, separate Static Site, CORS origins, or `VITE_API_URL` are required for this single-origin setup.

The API serves the Vite `dist` build and falls back to `index.html` for app navigation, so the service root opens SONRISETALK instead of showing "Cannot GET /". In production, the frontend automatically uses the same origin for API requests and Socket.IO. Configure `CLOUDINARY_URL` and `GEMINI_API_KEY` on the Web Service only if you want media upload and AI features; never expose these server secrets in `VITE_*` variables. To enable SONRISE AI, add `GEMINI_API_KEY` to the Render Web Service's Environment settings and redeploy; the key must belong to a Google AI Studio project with the Gemini API enabled and available quota.

### Background call notifications

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Add its public and private keys as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the Render Web Service's Environment settings, and set `VAPID_SUBJECT` to a contact address such as `mailto:you@example.com`. Keep the private key server-side and never add it to a `VITE_*` variable. Render applies the push-subscription database migration on startup. After redeployment, sign in on each device, open Settings → Notifications, and enable Incoming-call alerts; the browser asks for permission. Notifications can alert and reopen the app, but calls cannot be automatically answered while it is closed. iPhone/iPad users must add the site to the Home Screen, open that installed app, and enable notifications there. Notification sound follows device/browser settings; the in-app ringtone requires the app to be open.

### Group audio and video calls

Group conversations use LiveKit for SFU-routed audio/video. In an active group call, use **Invite** in the top-right to invite mutual-follow contacts; invitees can join in-app or from an incoming-call push notification. For the Render deployment, create a LiveKit Cloud project and copy its WebSocket URL (`wss://<your-project>.livekit.cloud`), API key, and API secret into the Render **Web Service → Environment** as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Keep the API secret server-side; never use a `VITE_*` variable or commit these values. Save the settings and redeploy the Web Service. The LiveKit URL must be reachable by both the API and clients; public production deployments require HTTPS/WSS. The server issues short-lived room tokens only after verifying active group membership or a call invitation. The PostgreSQL migrations add call participants and call invitations and are applied by the normal `npm start`/`npm run db:migrate` flow. Group calling remains unavailable until LiveKit is configured; one-to-one calls continue using the existing WebRTC/STUN/TURN flow.

On sign-in, the app offers an optional in-app prompt to enable incoming-call push notifications for the current browser/device. A user must tap **Enable alerts** before the browser can show its permission dialog; the app does not force browser permission. Background alerts require the existing VAPID configuration and a saved browser subscription. iPhone/iPad users must install the site to the Home Screen and enable notifications from that installed app.

To preserve data from an existing local `project.db`, first deploy the API so its PostgreSQL migrations have completed. Then, on the machine that has the SQLite file, temporarily set `DATABASE_URL` to Render PostgreSQL's **external** connection string and run `npm run db:import-sqlite`. For PowerShell:

```powershell
$env:DATABASE_URL = "<Render PostgreSQL external connection string>"
npm run db:import-sqlite
Remove-Item Env:DATABASE_URL
```

The importer reads `SQLITE_SOURCE_PATH` (default `project.db`), preserves row IDs and relationships, and writes all records in a single transaction. It refuses to write if the target PostgreSQL tables are not empty and does not modify the SQLite source. Stop the local app first so SQLite has no uncheckpointed write-ahead log, back up `project.db`, keep the connection string private, and run the importer only once.

## Cloudinary media

Cloudinary credentials are read from the server-only `CLOUDINARY_URL` or the `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` entries in `.env.local`; never use `VITE_CLOUDINARY_*`. Authenticated uploads go through `/api/media/upload`, which streams accepted images and videos to the account folder and records Cloudinary URLs/asset IDs in posts and stories. The API enforces file type/size limits and tags uploads under the signed-in account's folder.

Chat supports attached JPG, PNG, WebP, and GIF images up to 10 MB. Images are uploaded to the sender's Cloudinary account folder, shown in the conversation, and can be opened full-size by clicking them. Apply the message-image migration with `npm run db:migrate` and restart the API after upgrading.

Cloudinary voice-note playback uses authenticated MP3-only delivery so recordings made in WebM can play reliably in browser audio players. A conversation-member-only endpoint can generate a fresh playback link for both the sender and recipients.

Senders can delete their own message for everyone in the conversation. The deletion is persisted and synchronized to the sender's and recipients' connected devices.

Stories expire 24 hours after creation. In the story viewer, the options menu lets you mute another account's stories or delete your own; the API only permits the story owner to delete it. Muted accounts' stories stay hidden for that signed-in account.

## Calls and voice notes

One-to-one voice and video calls use WebRTC for media and authenticated Socket.IO events for invitations, negotiation, and call-state updates. Browsers request microphone or camera access only after the user starts or answers a call. Configure `STUN_URLS` and a production `TURN_URLS` plus server-only `TURN_SHARED_SECRET` for reliable connections across restrictive networks; TURN credentials are short-lived and are returned only to authenticated users. Production deployments must use HTTPS and secure WebSockets. Group audio and video calls use LiveKit; see the group-call setup above.

Voice notes are recorded with `MediaRecorder`, limited to 20 MB, checked against supported audio signatures, and uploaded as authenticated Cloudinary assets. Playback is proxied through an authenticated API endpoint that verifies conversation membership on every request; the audio bytes are not stored in the database or exposed through long-lived Cloudinary URLs. Configure Cloudinary before sending voice notes. Call records and outcomes are stored in PostgreSQL and available from the authenticated call-history API.

## Admin access

Admin promotion is disabled until the server operator configures `ADMIN_PROMOTION_PASSWORD_HASH`. Generate a scrypt hash with `npm run admin:hash`, put the hash in the server-only `.env.local`, and restart the API. Use a unique passphrase of at least 16 characters, keep it private, and never commit the hash or give the passphrase to regular users; anyone who knows it can promote their own account. Admin actions are checked against the database role on every request. Admins can review reports, inspect account profiles and recent posts, and delete non-admin accounts after confirmation. The app does not allow admins to sign in as, or impersonate, another user. Account deletion and other admin actions are recorded in an audit log.

Run automated checks with `npm test`. Build and database checks remain `npm run build`, `npm run db:validate`, and `npm run db:check`. Local automated tests do not replace two-user device testing; real microphone/camera access, Cloudinary delivery, and cross-network TURN connectivity require configured services and devices.

## Run the app with its API

`npm run dev` starts the API, applies pending PostgreSQL migrations, and starts Vite. Open `http://localhost:5173`. The login and signup flows create PostgreSQL-backed accounts and issue an API session. Select "Save login on this device" to add the account to the device's Switch account list; choose "Add account" there to sign in with another account. Media uploads can be up to 100 MB and must be JPEG, PNG, WebP, GIF, MP4, WebM, or QuickTime. SONRISE AI accepts up to four images (JPEG, PNG, WebP, HEIC, HEIF), PDFs, or TXT/MD/CSV files per message, up to 3 MB each and 12 MB per request. Each request includes the four most recent attachments in the rolling conversation history. AI attachments are sent to Gemini for analysis and are not stored by the app. API secrets are used only by the server. SONRISE AI uses the server-side `GEMINI_API_KEY` through a rate-limited API endpoint. Restart the API after adding or changing the key.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build`.
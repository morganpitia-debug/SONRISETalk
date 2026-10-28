# SONRISETALK 2.0

SONRISETALK includes Home, Discover, Create, Profile, Messages, Notifications, Settings, and SONRISE AI experiences.

## Underwater interface

Settings > Appearance lets you choose between the original default background and an underwater scene with white fish, plus the existing dark or light color scheme. The base environment, fish animation, and interactive foreground are separate stacking layers; fish ignore pointer input and stay clipped to the viewport. Fish movement respects reduced-motion preferences, and Home's text-post panels use opaque backgrounds for readability.

## Sign in and local development

The app requires login or signup; guest preview is not available. Run `npm run dev` to start the frontend and API together. In development, API requests and Socket.IO are proxied to the local API by default, so server-backed accounts, messaging, social features, and notifications work without setting `VITE_API_URL`. Set `VITE_API_URL` in `.env.local` only when connecting the frontend to an API at a different origin. Backend failures are shown as errors rather than replaced with sample content. Start with `.env.example` as a reference; `.env.local` is ignored by Git. Keep provider credentials out of `VITE_*` variables because Vite exposes those values to browser code.

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

## Optional face recovery

Face recovery is an opt-in alternative, not a replacement for passkeys. A signed-in user enrolls in Settings > Security after confirming their current password. The JPEG reference is encrypted with AES-256-GCM before it is stored in PostgreSQL; password recovery accepts a username, email, or phone, runs a five-second MediaPipe smile-expression check in the browser, then verifies the captured frame with a private FastAPI/DeepFace service using Facenet512 and `enforce_detection=True`. A successful match creates the same short-lived, single-use password-reset token used by passkey recovery. No raw image is intentionally written to application storage; image uploads are kept under the multipart in-memory threshold and cleared from buffers after processing.

The smile challenge and face comparison are not foolproof liveness checks or proof of legal identity. A smile blendshape can be spoofed, face matching can produce false results, and image uploads are sensitive biometric data. The interface describes these limitations; users should prefer passkeys. No email/SMS fallback is implemented because the app does not yet verify contact ownership. Face recovery is unavailable until both services are configured.

For local development, use Python 3.11 for the face service, install its dependencies, and run it alongside `npm run dev`:

```powershell
py -3.11 -m venv .venv-face
.\.venv-face\Scripts\Activate.ps1
python -m pip install -r face-verification\requirements.txt
python -m uvicorn main:app --app-dir face-verification --host 127.0.0.1 --port 8000
```

Set `FACE_RECOVERY_ENCRYPTION_KEY` to a stable 32-byte base64 key and `FACE_VERIFICATION_SERVICE_TOKEN` to a random secret of at least 32 characters in `.env.local`; use the same service token for both processes. For example, generate values with Node's `crypto.randomBytes(32).toString('base64')` and `crypto.randomBytes(32).toString('base64url')`. Do not commit these values. The encryption key must remain stable or enrolled references become unreadable. Keep `FACE_VERIFICATION_SERVICE_URL` private and point it at the Python service.

For deployment, run `face-verification` as a separate private Python 3.11 web service with build command `pip install -r face-verification/requirements.txt`, start command `uvicorn main:app --app-dir face-verification --host 0.0.0.0 --port $PORT`, and health check `/health`. Set the three `FACE_*` environment variables on the Node API service, using its private service URL and the shared service token. Keep the Python service off the public internet where the hosting platform supports private networking. The first face request downloads the DeepFace model weights, so allow time and memory for model initialization. Apply database migrations with `npm run db:migrate` before using face recovery.

## Render deployment

Deploy one Render Web Service to serve both the API and the built frontend. Create the managed PostgreSQL database in the same region as this service. Use branch `main`, build command `npm ci --include=dev && npm run build`, start command `npm start`, and health check path `/api/health`. Add `DATABASE_URL` to the **Web Service's Environment settings**, using the PostgreSQL database's **Internal Database URL**. A URL configured only on the database service is not automatically available to the Web Service; copy it to the Web Service or link the database to it. The start command applies pending PostgreSQL migrations before launching the server. No persistent disk, separate Static Site, CORS origins, or `VITE_API_URL` are required for this single-origin setup.

The API serves the Vite `dist` build and falls back to `index.html` for app navigation, so the service root opens SONRISETALK instead of showing "Cannot GET /". In production, the frontend automatically uses the same origin for API requests and Socket.IO. Configure `CLOUDINARY_URL` and `GEMINI_API_KEY` on the Web Service only if you want media upload and AI features; never expose these server secrets in `VITE_*` variables. To enable SONRISE AI, add `GEMINI_API_KEY` to the Render Web Service's Environment settings and redeploy; the key must belong to a Google AI Studio project with the Gemini API enabled and available quota.

### Background call notifications

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Add its public and private keys as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the Render Web Service's Environment settings, and set `VAPID_SUBJECT` to a contact address such as `mailto:you@example.com`. Keep the private key server-side and never add it to a `VITE_*` variable. Render applies the push-subscription database migration on startup. After redeployment, sign in on each device, open Settings → Notifications, and enable Incoming-call alerts; the browser asks for permission. Notifications can alert and reopen the app, but calls cannot be automatically answered while it is closed. iPhone/iPad users must add the site to the Home Screen, open that installed app, and enable notifications there. Notification sound follows device/browser settings; the in-app ringtone requires the app to be open.

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

One-to-one voice and video calls use WebRTC for media and authenticated Socket.IO events for invitations, negotiation, and call-state updates. Browsers request microphone or camera access only after the user starts or answers a call. Configure `STUN_URLS` and a production `TURN_URLS` plus server-only `TURN_SHARED_SECRET` for reliable connections across restrictive networks; TURN credentials are short-lived and are returned only to authenticated users. Production deployments must use HTTPS and secure WebSockets. Group calls are not enabled.

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
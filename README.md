# Aura OS

Aura OS is a short-video editing beta built with Next.js and Supabase. The web app handles accounts, private source uploads, a persistent job queue, clip review, and downloads. A local worker uses Faster-Whisper and FFmpeg on the creator's computer to transcribe short videos, rank promising transcript windows, add captions/vertical framing/zoom, and save finished MP4s to private Supabase Storage.

## Free beta limits

- One uploaded source video per account per UTC month.
- MP4, MOV, or WebM; 45 MB maximum and 30 minutes maximum.
- Up to five 720p vertical clips per source.
- The local processing computer must be on and connected while jobs run.
- The transcript uses an open-source speech model; moment ranking is a heuristic, not a promise that a clip will go viral.
- Aura does not download videos from YouTube. Upload a video you own or are allowed to edit.
- Paid plans and payment processing are not enabled.

The small file cap is intentional: Supabase Free currently limits individual uploads to 50 MB and includes 1 GB of Storage. Verify your account's dashboard limit before sharing this beta with others.

## Web app setup

Requirements: Node.js 20.9 or newer and a Supabase project.

1. Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable key.
2. In the Supabase SQL Editor, run these migrations in order:
   - `supabase/migrations/202610220001_aura_core.sql`
   - `supabase/migrations/202610240001_free_beta_limits.sql`
3. In Supabase Auth, add `http://localhost:3000/auth/callback` to the redirect URL allow list.
4. Run `npm ci`, then `npm run dev`.
5. Open `http://localhost:3000`, create an account, and confirm the email if Supabase requires it.

## Start the local video worker

The worker uses the creator computer's CPU. It is not a 24/7 cloud service; a job remains queued while the worker is stopped.

1. Install Python 3.11 and FFmpeg/FFprobe from their official sources. Ensure `ffmpeg` and `ffprobe` both work in a new terminal.
2. From the project folder, create a virtual environment and install the worker packages:

~~~powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r worker\requirements.txt
~~~

3. Copy `.env.worker.example` to `.env.worker.local`.
4. In `.env.worker.local`, set the Supabase URL, publishable key, **service-role key**, and `PYTHON_EXECUTABLE=.venv\\Scripts\\python.exe`. Get the service-role key from Supabase's API keys settings. It belongs only in this ignored local worker file; never paste it into chat, the browser, `NEXT_PUBLIC_` settings, or GitHub.
5. In a second terminal, run:

~~~powershell
npm run worker
~~~

The first job downloads the Whisper `base` model to the local machine; later jobs reuse it. Set `WHISPER_MODEL=tiny` if the computer is slow, or `small` for better transcription if it has enough memory. Upload videos with spoken audio. Jobs show their errors in the dashboard if a dependency or source is unavailable.

The worker downloads only time-limited signed URLs for files in Aura's private `source-videos` bucket. It does not receive YouTube URLs, and its Python child process does not receive the Supabase service-role key.

## Deploy the web app for access from other devices

The project includes `netlify.toml`; Netlify's Next.js adapter supports the App Router, route handlers, and Server Actions used here. The Netlify Free plan currently has a hard monthly credit limit; when exhausted, its sites pause until the next cycle instead of adding overage charges. Check the current plan in the dashboard and keep auto-recharge/payment settings off.

1. Import the public `Mrinvincibleee/Aura-Os` GitHub repository in Netlify, using the repository root.
2. Keep the plan on Free. Do not enter a payment method to bypass any billing prompt.
3. In the Netlify site's environment settings, set only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the web app.
4. After Netlify gives the site a URL, add `https://YOUR-SITE.netlify.app/auth/callback` to Supabase Auth's redirect URL allow list.
5. Deploy and verify signup, email confirmation, login, upload, and dashboard refresh on the deployed URL.
6. Keep running `npm run worker` on the creator computer to process jobs.

The existing GitHub Pages URL serves `docs/index.html`, a static design preview. It cannot run the Next.js backend, authentication callbacks, database access, or worker. Use the Netlify deployment for the actual web app.

## Optional external processing adapter

The worker can also send jobs to a private processor implementing the request/response contract in `worker/clip-worker.mjs`. Set `CLIP_PROCESSOR_URL` and `CLIP_PROCESSOR_API_KEY` only in the worker environment to use it. An external processor must upload output MP4s to the supplied short-lived signed upload slots before responding.

## Before a broader customer launch

The current $0 setup is a small beta, not a high-availability production service. It depends on one local worker computer, Supabase Free quotas, and Netlify Free credits. Add a reliable worker host and a suitable video-processing budget, implement reviewed privacy/terms and account-deletion flows, and connect a legitimate business payment provider before selling plans. Never promise virality or upload videos without the owner's permission.

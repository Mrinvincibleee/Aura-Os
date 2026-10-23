# Aura OS full-stack foundation

This project replaces the static mockup with a Next.js app backed by Supabase Auth, Postgres, and private Storage. It includes owner-scoped database policies, resumable source-video uploads, YouTube URL intake, a persistent job queue, and a separate worker adapter for an AI clipping service.

## Requirements

- Node.js 20.9 or newer
- A Supabase project
- A clipping processor that implements the adapter contract below
- A web host for Next.js and an always-on worker host

## Local setup

1. Copy .env.example to .env.local.
2. Add your Supabase project URL and publishable key.
3. Open the Supabase SQL Editor and run supabase/migrations/202610220001_aura_core.sql once.
4. In Supabase Auth, configure the local redirect URL http://localhost:3000/auth/callback.
5. Install and start the web app:

~~~powershell
npm install
npm run dev
~~~

6. Open http://localhost:3000, create an account, and open the creator workspace.
7. After setting a clipping processor and the worker-only service role key, start the worker in another terminal:

~~~powershell
npm run worker
~~~

Never put the Supabase service role key in a NEXT_PUBLIC_ variable or browser code. It belongs only in the worker environment.

## Processing adapter contract

The worker claims jobs atomically from Postgres, creates a temporary signed source URL for uploads, and sends the processor:

~~~json
{
  "jobId": "uuid",
  "videoId": "uuid",
  "sourceUrl": "https://temporary-source-url",
  "outputBucket": "clip-exports",
  "outputPathPrefix": "owner-uuid/job-uuid/",
  "outputUploads": [
    { "index": 1, "path": "owner-uuid/job-uuid/clip-001.mp4", "token": "short-lived-upload-token" }
  ]
}
~~~

The processor must return JSON within 45 minutes:

~~~json
{
  "clips": [
    {
      "output_index": 1,
      "title": "The useful moment",
      "start_seconds": 42.5,
      "end_seconds": 77.2,
      "virality_score": 91,
      "transcript": "A short transcript for the clip"
    }
  ]
}
~~~

For every result, upload an MP4 to the corresponding outputUploads[index].path in the private clip-exports bucket using its signed token. Return output indices 1–15. The worker validates clip metadata, stores records, and marks the job complete only after the processor responds.

YouTube links are recorded and queued; the processor must have a supported, authorized way to read each source. Aura OS does not download or process a YouTube video by itself.

## Deployment

- Web app: deploy this folder to a host whose plan permits your intended business use. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as build and runtime environment variables. Keep .env.local on your computer; it is ignored by Git.
- Supabase: run the migration, add your deployed site's /auth/callback URL to the Supabase Auth redirect allow list, and keep both video buckets private.
- Worker: deploy worker/clip-worker.mjs as a long-running Node process. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLIP_PROCESSOR_URL, and CLIP_PROCESSOR_API_KEY only in its private environment.
- AI: choose and connect a clipping, transcription, and video-rendering provider that implements the request/response contract. Until that provider and worker are deployed, jobs remain queued. The worker is separate so long renders do not block web requests.

Prices follow your blueprint. Monthly usage limits are initial assumptions and should be confirmed before billing is enabled.


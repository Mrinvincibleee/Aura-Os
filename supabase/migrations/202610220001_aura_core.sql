create extension if not exists pgcrypto;

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled video',
  source_type text not null check (source_type in ('youtube', 'upload')),
  source_url text,
  storage_path text,
  file_size_bytes bigint,
  content_type text,
  status text not null default 'received' check (status in ('received', 'uploading', 'queued', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check ((source_type = 'youtube' and source_url is not null) or (source_type = 'upload' and storage_path is not null))
);

create table public.clip_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  error text,
  worker_name text,
  requested_options jsonb not null default '{"captions":true,"smart_zoom":true,"sound_effects":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (video_id, owner_id) references public.videos(id, owner_id) on delete cascade
);

create unique index clip_jobs_one_active_per_video on public.clip_jobs(video_id) where status in ('queued', 'processing');
create index videos_owner_created_idx on public.videos(owner_id, created_at desc);
create index clip_jobs_owner_created_idx on public.clip_jobs(owner_id, created_at desc);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null,
  job_id uuid not null,
  title text not null,
  start_seconds numeric(10,3) not null check (start_seconds >= 0),
  end_seconds numeric(10,3) not null check (end_seconds > start_seconds),
  virality_score numeric(5,2) check (virality_score between 0 and 100),
  transcript text,
  output_path text not null,
  created_at timestamptz not null default now(),
  foreign key (video_id, owner_id) references public.videos(id, owner_id) on delete cascade,
  foreign key (job_id, owner_id) references public.clip_jobs(id, owner_id) on delete cascade
);
create index clips_owner_created_idx on public.clips(owner_id, created_at desc);

alter table public.videos enable row level security;
alter table public.clip_jobs enable row level security;
alter table public.clips enable row level security;

grant select, insert, delete on public.videos to authenticated;
grant select on public.clip_jobs to authenticated;
grant select on public.clips to authenticated;

create policy "Owners can view videos" on public.videos for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can add videos" on public.videos for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Owners can delete videos" on public.videos for delete to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can view jobs" on public.clip_jobs for select to authenticated using (owner_id = (select auth.uid()));
create policy "Owners can view clips" on public.clips for select to authenticated using (owner_id = (select auth.uid()));

create or replace function public.queue_video_job(p_video_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_video public.videos%rowtype;
  created_job_id uuid;
begin
  select * into selected_video
  from public.videos
  where id = p_video_id and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'video_not_found';
  end if;
  if selected_video.status not in ('received', 'uploading', 'failed') then
    raise exception 'video_not_queueable';
  end if;

  insert into public.clip_jobs(owner_id, video_id, status)
  values (auth.uid(), p_video_id, 'queued')
  returning id into created_job_id;

  update public.videos set status = 'queued', updated_at = now() where id = p_video_id;
  return created_job_id;
end;
$$;
revoke all on function public.queue_video_job(uuid) from public, anon;
grant execute on function public.queue_video_job(uuid) to authenticated;

create or replace function public.claim_next_clip_job(p_worker_name text)
returns table(job_id uuid, owner_id uuid, video_id uuid, source_url text, storage_path text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job record;
begin
  select j.id, j.owner_id, j.video_id, v.source_url, v.storage_path
  into selected_job
  from public.clip_jobs j
  join public.videos v on v.id = j.video_id and v.owner_id = j.owner_id
  where j.status = 'queued'
     or (j.status = 'processing' and j.updated_at < now() - interval '90 minutes')
  order by j.created_at
  limit 1
  for update of j skip locked;

  if not found then
    return;
  end if;

  update public.clip_jobs
  set status = 'processing', progress = 5, worker_name = p_worker_name, error = null, updated_at = now()
  where id = selected_job.id;
  update public.videos set status = 'processing', updated_at = now() where id = selected_job.video_id;

  job_id := selected_job.id;
  owner_id := selected_job.owner_id;
  video_id := selected_job.video_id;
  source_url := selected_job.source_url;
  storage_path := selected_job.storage_path;
  return next;
end;
$$;
revoke all on function public.claim_next_clip_job(text) from public, anon, authenticated;
grant execute on function public.claim_next_clip_job(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('source-videos', 'source-videos', false, 2147483648, array['video/mp4','video/quicktime','video/webm','video/x-matroska']),
  ('clip-exports', 'clip-exports', false, 536870912, array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false;

create policy "Users upload source videos to their folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users view their source videos"
  on storage.objects for select to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users delete their source videos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'source-videos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Users view their clip exports"
  on storage.objects for select to authenticated
  using (bucket_id = 'clip-exports' and (storage.foldername(name))[1] = (select auth.uid()::text));

comment on table public.videos is 'User-owned source videos from YouTube URLs or private uploads.';
comment on table public.clip_jobs is 'Persistent processing queue and state for Aura OS clipping jobs.';
comment on table public.clips is 'Generated clip metadata. Export files live in private clip-exports storage.';


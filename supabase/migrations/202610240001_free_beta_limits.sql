-- Free beta safety: enforce one uploaded source video per account per UTC month
-- and match uploads to Supabase Free's 50 MB per-file maximum.

create table if not exists public.profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  month_start date not null default ((date_trunc('month', now() at time zone 'UTC'))::date),
  videos_used smallint not null default 0 check (videos_used between 0 and 1),
  created_at timestamptz not null default now()
);

alter table public.videos
  add column if not exists quota_reserved boolean not null default false;

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
drop policy if exists "Owners can view their profile" on public.profiles;
create policy "Owners can view their profile"
  on public.profiles for select to authenticated
  using (owner_id = (select auth.uid()));

create or replace function public.handle_new_aura_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(owner_id) values (new.id) on conflict (owner_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_aura_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_aura_profile on auth.users;
create trigger on_auth_user_created_aura_profile
  after insert on auth.users
  for each row execute function public.handle_new_aura_profile();

insert into public.profiles(owner_id)
select id from auth.users
on conflict (owner_id) do nothing;

-- The application accepts files below this ceiling and the project-level
-- Supabase Free upload cap still applies if it is configured lower.
update storage.buckets
set file_size_limit = 47185920
where id = 'source-videos';

create or replace function public.reserve_video_upload(
  p_video_id uuid,
  p_title text,
  p_storage_path text,
  p_file_size bigint,
  p_content_type text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account_profile public.profiles%rowtype;
  current_month date := (date_trunc('month', now() at time zone 'UTC'))::date;
begin
  if auth.uid() is null then
    raise exception 'sign_in_required';
  end if;
  if p_file_size <= 0 or p_file_size > 47185920 then
    raise exception 'free_beta_file_limit_45mb';
  end if;
  if p_content_type not in ('video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska') then
    raise exception 'unsupported_video_type';
  end if;
  if p_storage_path not like auth.uid()::text || '/' || p_video_id::text || '/%' then
    raise exception 'invalid_storage_path';
  end if;

  insert into public.profiles(owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  select * into account_profile from public.profiles where owner_id = auth.uid() for update;
  if account_profile.month_start <> current_month then
    update public.profiles set month_start = current_month, videos_used = 0
    where owner_id = auth.uid() returning * into account_profile;
  end if;
  if account_profile.videos_used >= 1 then
    raise exception 'free_monthly_video_limit_reached';
  end if;

  insert into public.videos(
    id, owner_id, title, source_type, storage_path, file_size_bytes, content_type, status, quota_reserved
  ) values (
    p_video_id, auth.uid(), left(coalesce(nullif(p_title, ''), 'Untitled video'), 180),
    'upload', p_storage_path, p_file_size, p_content_type, 'uploading', true
  );
  update public.profiles set videos_used = videos_used + 1 where owner_id = auth.uid();
  return p_video_id;
end;
$$;

revoke all on function public.reserve_video_upload(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.reserve_video_upload(uuid, text, text, bigint, text) to authenticated;

drop policy if exists "Users delete their clip exports" on storage.objects;
create policy "Users delete their clip exports"
  on storage.objects for delete to authenticated
  using (bucket_id = 'clip-exports' and (storage.foldername(name))[1] = (select auth.uid()::text));

create or replace function public.queue_video_job(p_video_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_video public.videos%rowtype;
  account_profile public.profiles%rowtype;
  created_job_id uuid;
  current_month date := (date_trunc('month', now() at time zone 'UTC'))::date;
begin
  select * into selected_video
  from public.videos
  where id = p_video_id and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'video_not_found';
  end if;
  if selected_video.source_type <> 'upload' or selected_video.storage_path is null then
    raise exception 'upload_a_video_you_have_permission_to_edit';
  end if;
  if selected_video.status not in ('received', 'uploading', 'failed') then
    raise exception 'video_not_queueable';
  end if;

  insert into public.profiles(owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  select * into account_profile
  from public.profiles
  where owner_id = auth.uid()
  for update;

  if account_profile.month_start <> current_month then
    update public.profiles
    set month_start = current_month, videos_used = 0
    where owner_id = auth.uid()
    returning * into account_profile;
  end if;

  if not selected_video.quota_reserved then
    if account_profile.videos_used >= 1 then
      raise exception 'free_monthly_video_limit_reached';
    end if;
    update public.profiles set videos_used = videos_used + 1 where owner_id = auth.uid();
    update public.videos set quota_reserved = true where id = p_video_id;
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

comment on table public.profiles is 'Aura OS free-beta usage counters. Paid billing is not enabled.';

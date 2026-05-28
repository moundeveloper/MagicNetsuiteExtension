create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 2000),
  category text not null default 'Feature',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'new' check (
    status in ('new', 'reviewing', 'planned', 'in_progress', 'released', 'declined', 'closed')
  ),
  admin_response text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feature_requests_user_id_idx
  on public.feature_requests (user_id, updated_at desc);

create index if not exists feature_requests_status_idx
  on public.feature_requests (status, updated_at desc);

create or replace function public.set_feature_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feature_requests_updated_at on public.feature_requests;
create trigger feature_requests_updated_at
before update on public.feature_requests
for each row
execute function public.set_feature_requests_updated_at();

alter table public.feature_requests enable row level security;

-- This extension uses an anonymous key and stores a generated browser ID in user_id.
-- Tighten these policies further if you later add authenticated accounts.
drop policy if exists "feature requests public insert" on public.feature_requests;
create policy "feature requests public insert"
on public.feature_requests for insert
with check (true);

drop policy if exists "feature requests public select" on public.feature_requests;
create policy "feature requests public select"
on public.feature_requests for select
using (true);

drop policy if exists "feature requests public update" on public.feature_requests;
create policy "feature requests public update"
on public.feature_requests for update
using (true)
with check (true);

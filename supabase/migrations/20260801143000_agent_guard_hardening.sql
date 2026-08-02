create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key,
  email text unique not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_auth_user_created();

insert into public.users (id, email)
select id, coalesce(email, '')
from auth.users
on conflict (id) do update
  set email = excluded.email;

alter table public.agents
  add column if not exists api_key_hash text,
  add column if not exists api_key_prefix text,
  add column if not exists status text not null default 'active',
  add column if not exists last_used_at timestamptz,
  add column if not exists rotated_at timestamptz,
  add column if not exists revoked_at timestamptz;

update public.agents
set
  api_key_hash = encode(digest(api_key, 'sha256'), 'hex'),
  api_key_prefix = left(api_key, 14)
where api_key is not null
  and (api_key_hash is null or api_key_prefix is null);

alter table public.agents
  add constraint agents_status_check check (status in ('active', 'revoked'));

create unique index if not exists agents_api_key_hash_key
  on public.agents (api_key_hash)
  where api_key_hash is not null;

create index if not exists agents_user_id_status_idx
  on public.agents (user_id, status);

create index if not exists pulse_logs_agent_id_timestamp_idx
  on public.pulse_logs (agent_id, "timestamp" desc);

delete from public.state_snapshots a
using public.state_snapshots b
where a.agent_id = b.agent_id
  and a.id <> b.id
  and a.saved_at < b.saved_at;

create unique index if not exists state_snapshots_agent_id_key
  on public.state_snapshots (agent_id);

delete from public.kill_switch a
using public.kill_switch b
where a.agent_id = b.agent_id
  and a.id <> b.id
  and a.updated_at < b.updated_at;

create unique index if not exists kill_switch_agent_id_key
  on public.kill_switch (agent_id);

drop policy if exists "Users can insert their agents' kill switch" on public.kill_switch;
create policy "Users can insert their agents' kill switch"
  on public.kill_switch
  for insert
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
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

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  agent_name text not null,
  api_key text unique,
  daily_budget numeric not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pulse_logs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  task text not null,
  progress numeric not null,
  current_cost numeric not null,
  timestamp timestamptz not null default now()
);

create table if not exists public.state_snapshots (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  state_summary text not null,
  saved_at timestamptz not null default now()
);

create table if not exists public.kill_switch (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  command text not null default 'CONTINUE',
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.agents enable row level security;
alter table public.pulse_logs enable row level security;
alter table public.state_snapshots enable row level security;
alter table public.kill_switch enable row level security;

drop policy if exists "Users can view their own profile" on public.users;
create policy "Users can view their own profile"
  on public.users
  for select
  using (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users
  for update
  using (id = auth.uid());

drop policy if exists "Users can view their own agents" on public.agents;
create policy "Users can view their own agents"
  on public.agents
  for select
  using (user_id = auth.uid());

drop policy if exists "Users can insert their own agents" on public.agents;
create policy "Users can insert their own agents"
  on public.agents
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can update their own agents" on public.agents;
create policy "Users can update their own agents"
  on public.agents
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can view their agents' pulse logs" on public.pulse_logs;
create policy "Users can view their agents' pulse logs"
  on public.pulse_logs
  for select
  using (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Agents can insert pulse logs" on public.pulse_logs;
create policy "Agents can insert pulse logs"
  on public.pulse_logs
  for insert
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can view their agents' state snapshots" on public.state_snapshots;
create policy "Users can view their agents' state snapshots"
  on public.state_snapshots
  for select
  using (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can insert their agents' state snapshots" on public.state_snapshots;
create policy "Users can insert their agents' state snapshots"
  on public.state_snapshots
  for insert
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can update their agents' state snapshots" on public.state_snapshots;
create policy "Users can update their agents' state snapshots"
  on public.state_snapshots
  for update
  using (agent_id in (select id from public.agents where user_id = auth.uid()))
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can view their agents' kill switch" on public.kill_switch;
create policy "Users can view their agents' kill switch"
  on public.kill_switch
  for select
  using (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can insert their agents' kill switch" on public.kill_switch;
create policy "Users can insert their agents' kill switch"
  on public.kill_switch
  for insert
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can update their agents' kill switch" on public.kill_switch;
create policy "Users can update their agents' kill switch"
  on public.kill_switch
  for update
  using (agent_id in (select id from public.agents where user_id = auth.uid()))
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

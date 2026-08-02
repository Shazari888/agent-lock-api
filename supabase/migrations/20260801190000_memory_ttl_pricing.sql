create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  memory_key text not null,
  memory_value jsonb not null,
  payload_bytes integer not null,
  ttl_hours integer not null check (ttl_hours > 0 and ttl_hours <= 720),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists memory_items_agent_key_unique
  on public.memory_items (agent_id, memory_key);

create index if not exists memory_items_expires_at_idx
  on public.memory_items (expires_at);

alter table public.memory_items enable row level security;

drop policy if exists "Users can view their agents' memory items" on public.memory_items;
create policy "Users can view their agents' memory items"
  on public.memory_items
  for select
  using (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can insert their agents' memory items" on public.memory_items;
create policy "Users can insert their agents' memory items"
  on public.memory_items
  for insert
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can update their agents' memory items" on public.memory_items;
create policy "Users can update their agents' memory items"
  on public.memory_items
  for update
  using (agent_id in (select id from public.agents where user_id = auth.uid()))
  with check (agent_id in (select id from public.agents where user_id = auth.uid()));

drop policy if exists "Users can delete their agents' memory items" on public.memory_items;
create policy "Users can delete their agents' memory items"
  on public.memory_items
  for delete
  using (agent_id in (select id from public.agents where user_id = auth.uid()));

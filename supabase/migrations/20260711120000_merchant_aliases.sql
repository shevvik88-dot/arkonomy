create table merchant_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_key text not null,
  canonical_key text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  unique (user_id, alias_key, canonical_key)
);

alter table merchant_aliases enable row level security;

create policy "select own merchant_aliases" on merchant_aliases
  for select using (auth.uid() = user_id);

create policy "insert own merchant_aliases" on merchant_aliases
  for insert with check (auth.uid() = user_id);

create policy "delete own merchant_aliases" on merchant_aliases
  for delete using (auth.uid() = user_id);

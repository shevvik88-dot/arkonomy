create table scheduled_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  description text not null,
  category_name text not null default 'Other',
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table scheduled_payments enable row level security;

create policy "select own scheduled_payments" on scheduled_payments
  for select using (auth.uid() = user_id);

create policy "insert own scheduled_payments" on scheduled_payments
  for insert with check (auth.uid() = user_id);

create policy "update own scheduled_payments" on scheduled_payments
  for update using (auth.uid() = user_id);

create policy "delete own scheduled_payments" on scheduled_payments
  for delete using (auth.uid() = user_id);

create table lesson_streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_streak int not null default 0,
  last_completed_date date,
  updated_at timestamptz not null default now()
);

alter table lesson_streaks enable row level security;

create policy "select own lesson_streaks" on lesson_streaks
  for select using (auth.uid() = user_id);

create policy "insert own lesson_streaks" on lesson_streaks
  for insert with check (auth.uid() = user_id);

create policy "update own lesson_streaks" on lesson_streaks
  for update using (auth.uid() = user_id);

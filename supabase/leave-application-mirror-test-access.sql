-- Use only in a non-production Supabase project containing synthetic test rows.
-- This intentionally permits unauthenticated users to read and edit every row.
alter table public.leave_application_mirror enable row level security;

revoke all on table public.leave_application_mirror from anon, authenticated;
grant select, insert, update on table public.leave_application_mirror to anon;

drop policy if exists "Allow public test mirror reads"
  on public.leave_application_mirror;
create policy "Allow public test mirror reads"
  on public.leave_application_mirror
  for select
  to anon
  using (true);

drop policy if exists "Allow public test mirror updates"
  on public.leave_application_mirror;
create policy "Allow public test mirror updates"
  on public.leave_application_mirror
  for update
  to anon
  using (true)
  with check (true);

drop policy if exists "Allow public test mirror inserts"
  on public.leave_application_mirror;
create policy "Allow public test mirror inserts"
  on public.leave_application_mirror
  for insert
  to anon
  with check (
    employee_erp_id = 'DEMO'
    and status = 1
    and status_description = 'Pending'
    and source_payload ->> 'source' = 'portal_demo_submission'
  );

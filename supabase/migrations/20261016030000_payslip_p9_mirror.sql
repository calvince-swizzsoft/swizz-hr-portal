-- TEMPORARY, DEVELOPMENT TEST DATA ONLY: payslips and P9 forms for UI development while the ERP
-- payroll API is unknown. Figures are typed in by hand and only displayed; the portal never calculates
-- pay or tax. Column names are provisional until the ERP payroll API contract is known.
-- PDFs are uploaded to the private "hr-documents" storage bucket, and "FilePath" holds the path
-- inside it (for example payslips/2026-10.pdf). Signed-in users can read every row and file.
-- Safe to run more than once.
--
-- To undo:
--   drop table public.payslip_mirror; drop table public.p9_mirror;
--   drop policy "TEMPORARY signed-in read of test HR documents" on storage.objects;
--   then delete the hr-documents bucket in Storage.

create table if not exists public.payslip_mirror (
  "Id" uuid primary key default gen_random_uuid(),
  "EmployeeId" uuid not null references public.employee_mirror ("Id") on delete cascade,
  "Year" integer not null check ("Year" between 2000 and 2100),
  "Month" integer not null check ("Month" between 1 and 12),
  "GrossPay" numeric(14, 2),
  "TotalDeductions" numeric(14, 2),
  "NetPay" numeric(14, 2),
  "FilePath" text,
  unique ("EmployeeId", "Year", "Month")
);

create table if not exists public.p9_mirror (
  "Id" uuid primary key default gen_random_uuid(),
  "EmployeeId" uuid not null references public.employee_mirror ("Id") on delete cascade,
  "Year" integer not null check ("Year" between 2000 and 2100),
  "FilePath" text,
  unique ("EmployeeId", "Year")
);

comment on table public.payslip_mirror is 'TEMPORARY test payslips for UI development. Not a source of truth.';
comment on table public.p9_mirror is 'TEMPORARY test P9 forms for UI development. Not a source of truth.';

-- Signed-in users can read; rows are added and changed in the Supabase dashboard.
alter table public.payslip_mirror enable row level security;
alter table public.p9_mirror enable row level security;
revoke all on table public.payslip_mirror, public.p9_mirror from anon, authenticated;
grant select on table public.payslip_mirror, public.p9_mirror to authenticated;

drop policy if exists "TEMPORARY signed-in read of test payslips" on public.payslip_mirror;
create policy "TEMPORARY signed-in read of test payslips"
  on public.payslip_mirror for select to authenticated using (true);

drop policy if exists "TEMPORARY signed-in read of test P9 forms" on public.p9_mirror;
create policy "TEMPORARY signed-in read of test P9 forms"
  on public.p9_mirror for select to authenticated using (true);

-- Private bucket for the PDFs: no public links, PDF files only.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('hr-documents', 'hr-documents', false, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "TEMPORARY signed-in read of test HR documents" on storage.objects;
create policy "TEMPORARY signed-in read of test HR documents"
  on storage.objects for select to authenticated using (bucket_id = 'hr-documents');

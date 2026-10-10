-- تاریخچه تغییرات مدیریتی؛ این جدول فقط از طریق Edge Function سمت سرور نوشته شود.
create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  admin_email text not null,
  target_user_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_logs enable row level security;

-- هیچ سیاستی برای anon/authenticated تعریف نشده؛ دسترسی مرورگر مسدود می‌ماند.
-- Edge Function با service_role از سمت سرور به جدول دسترسی دارد.

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_user_idx
  on public.admin_audit_logs (target_user_id);

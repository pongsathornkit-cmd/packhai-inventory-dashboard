create extension if not exists pgcrypto with schema extensions;

create table if not exists public.plain_design_products (
  sku text primary key,
  status text not null default 'waiting_ai_images'
    check (status in ('passed', 'ai_done_waiting_review', 'needs_ai_revision', 'waiting_ai_images')),
  notes text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plain_design_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  sku text not null,
  asset_group text not null
    check (asset_group in ('product_images', 'packaging_images', 'factory_files')),
  file_name text not null,
  file_path text not null unique,
  file_size bigint not null default 0,
  mime_type text not null default 'application/octet-stream',
  public_url text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists plain_design_assets_sku_uploaded_idx
  on public.plain_design_assets (sku, uploaded_at desc);

insert into storage.buckets (id, name, public, file_size_limit)
values ('plain-design-assets', 'plain-design-assets', true, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table public.plain_design_products enable row level security;
alter table public.plain_design_assets enable row level security;

drop policy if exists "public plain design products read" on public.plain_design_products;
create policy "public plain design products read"
on public.plain_design_products
for select
to anon, authenticated
using (true);

drop policy if exists "public plain design products write" on public.plain_design_products;
create policy "public plain design products write"
on public.plain_design_products
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public plain design assets read" on public.plain_design_assets;
create policy "public plain design assets read"
on public.plain_design_assets
for select
to anon, authenticated
using (true);

drop policy if exists "public plain design assets write" on public.plain_design_assets;
create policy "public plain design assets write"
on public.plain_design_assets
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "public plain design storage read" on storage.objects;
create policy "public plain design storage read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'plain-design-assets');

drop policy if exists "public plain design storage insert" on storage.objects;
create policy "public plain design storage insert"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'plain-design-assets');

drop policy if exists "public plain design storage update" on storage.objects;
create policy "public plain design storage update"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'plain-design-assets')
with check (bucket_id = 'plain-design-assets');

drop policy if exists "public plain design storage delete" on storage.objects;
create policy "public plain design storage delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'plain-design-assets');

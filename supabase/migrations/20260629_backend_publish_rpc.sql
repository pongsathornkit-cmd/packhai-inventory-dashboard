create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.app_secret_settings (
  key text primary key,
  salt text not null,
  secret_hash text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table private.app_secret_settings enable row level security;

create or replace function private.set_app_write_key(p_write_key text)
returns void
language plpgsql
security definer
set search_path = private, extensions
as $$
declare
  v_salt text;
begin
  if length(coalesce(p_write_key, '')) < 20 then
    raise exception 'SUPABASE_WRITE_KEY must be at least 20 characters.';
  end if;

  v_salt := encode(extensions.gen_random_bytes(16), 'hex');

  insert into private.app_secret_settings (key, salt, secret_hash, updated_at)
  values (
    'supabase_write_key',
    v_salt,
    encode(extensions.digest(p_write_key || ':' || v_salt, 'sha256'), 'hex'),
    now()
  )
  on conflict (key) do update
  set
    salt = excluded.salt,
    secret_hash = excluded.secret_hash,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function private.app_write_key_matches(p_write_key text)
returns boolean
language plpgsql
security definer
set search_path = private, extensions
as $$
declare
  v_secret private.app_secret_settings;
  v_hash text;
begin
  if length(coalesce(p_write_key, '')) < 20 then
    return false;
  end if;

  select *
  into v_secret
  from private.app_secret_settings
  where key = 'supabase_write_key';

  if v_secret.key is null then
    return false;
  end if;

  v_hash := encode(extensions.digest(p_write_key || ':' || v_secret.salt, 'sha256'), 'hex');
  return v_hash = v_secret.secret_hash;
end;
$$;

create or replace function private.sync_publish_app_impl(
  p_snapshots jsonb default '[]'::jsonb,
  p_movements jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_snapshot jsonb;
  v_movement jsonb;
  v_snapshot_count integer := 0;
  v_movement_count integer := 0;
  v_key text;
  v_movement_key text;
  v_stock_shop_id bigint;
begin
  if jsonb_typeof(coalesce(p_snapshots, '[]'::jsonb)) <> 'array' then
    raise exception 'p_snapshots must be a JSON array.';
  end if;

  if jsonb_typeof(coalesce(p_movements, '[]'::jsonb)) <> 'array' then
    raise exception 'p_movements must be a JSON array.';
  end if;

  for v_snapshot in
    select value from jsonb_array_elements(coalesce(p_snapshots, '[]'::jsonb))
  loop
    v_key := left(trim(coalesce(v_snapshot ->> 'key', '')), 160);
    if v_key = '' then
      continue;
    end if;

    insert into public.app_snapshots (key, payload, updated_at)
    values (
      v_key,
      coalesce(v_snapshot -> 'payload', '{}'::jsonb),
      coalesce(nullif(v_snapshot ->> 'updated_at', '')::timestamptz, now())
    )
    on conflict (key) do update
    set
      payload = excluded.payload,
      updated_at = excluded.updated_at;

    v_snapshot_count := v_snapshot_count + 1;
  end loop;

  for v_movement in
    select value from jsonb_array_elements(coalesce(p_movements, '[]'::jsonb))
  loop
    v_movement_key := left(trim(coalesce(v_movement ->> 'movement_key', '')), 120);
    v_stock_shop_id := nullif(v_movement ->> 'stock_shop_id', '')::bigint;

    if v_movement_key = '' or v_stock_shop_id is null then
      continue;
    end if;

    insert into public.packhai_stock_movements (
      movement_key,
      stock_shop_id,
      sku,
      created_at,
      payload,
      updated_at
    )
    values (
      v_movement_key,
      v_stock_shop_id,
      upper(left(trim(coalesce(v_movement ->> 'sku', '')), 160)),
      nullif(v_movement ->> 'created_at', '')::timestamptz,
      coalesce(v_movement -> 'payload', '{}'::jsonb),
      coalesce(nullif(v_movement ->> 'updated_at', '')::timestamptz, now())
    )
    on conflict (movement_key) do update
    set
      stock_shop_id = excluded.stock_shop_id,
      sku = excluded.sku,
      created_at = excluded.created_at,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

    v_movement_count := v_movement_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'snapshots', v_snapshot_count,
    'movements', v_movement_count
  );
end;
$$;

create or replace function public.sync_publish_app(
  p_write_key text,
  p_snapshots jsonb default '[]'::jsonb,
  p_movements jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if not private.app_write_key_matches(p_write_key) then
    raise exception 'Unauthorized Supabase write key.' using errcode = '28000';
  end if;

  return private.sync_publish_app_impl(p_snapshots, p_movements);
end;
$$;

revoke all on function private.set_app_write_key(text) from public;
revoke all on function private.app_write_key_matches(text) from public;
revoke all on function private.sync_publish_app_impl(jsonb, jsonb) from public;
revoke all on function public.sync_publish_app(text, jsonb, jsonb) from public;

grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.app_write_key_matches(text) to anon, authenticated, service_role;
grant execute on function private.sync_publish_app_impl(jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.sync_publish_app(text, jsonb, jsonb) to anon, authenticated, service_role;

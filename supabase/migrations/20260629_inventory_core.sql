create extension if not exists pgcrypto with schema extensions;

create table if not exists public.products (
  sku text primary key,
  name text not null default '',
  barcode text not null default '',
  prop text not null default '',
  image_url text not null default '',
  image_source text not null default '',
  product_id text not null default '',
  product_master_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouses (
  id bigint primary key,
  name text not null,
  api_name text not null default '',
  label text not null default '',
  source text not null default 'website',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_balances (
  sku text not null references public.products (sku) on update cascade on delete cascade,
  warehouse_id bigint not null references public.warehouses (id) on update cascade on delete restrict,
  quantity numeric(14, 2) not null default 0 check (quantity >= 0),
  waiting numeric(14, 2) not null default 0 check (waiting >= 0),
  wait_import numeric(14, 2) not null default 0 check (wait_import >= 0),
  available numeric(14, 2) not null default 0 check (available >= 0),
  source text not null default 'Website Stock',
  source_ref text not null default '',
  manual_update_note text not null default '',
  last_transaction_id text not null default '',
  updated_at timestamptz not null default now(),
  primary key (sku, warehouse_id)
);

create table if not exists public.stock_transactions (
  id text primary key,
  created_at timestamptz not null default now(),
  sku text not null references public.products (sku) on update cascade on delete restrict,
  warehouse_id bigint not null references public.warehouses (id) on update cascade on delete restrict,
  operation text not null check (operation in ('add', 'set', 'subtract')),
  before_quantity numeric(14, 2) not null default 0 check (before_quantity >= 0),
  input_quantity numeric(14, 2) not null default 0 check (input_quantity >= 0),
  after_quantity numeric(14, 2) not null default 0 check (after_quantity >= 0),
  delta_quantity numeric(14, 2) not null default 0,
  actor text not null default 'Website',
  note text not null default '',
  source_text text not null default '',
  source text not null default 'Website Stock'
);

create table if not exists public.sync_jobs (
  id bigint generated always as identity primary key,
  job_type text not null,
  status text not null check (status in ('queued', 'running', 'ok', 'warning', 'failed')),
  message text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stock_balances_warehouse_quantity_idx
  on public.stock_balances (warehouse_id, quantity desc);

create index if not exists stock_balances_updated_idx
  on public.stock_balances (updated_at desc);

create index if not exists stock_transactions_sku_created_idx
  on public.stock_transactions (sku, created_at desc);

create index if not exists stock_transactions_warehouse_created_idx
  on public.stock_transactions (warehouse_id, created_at desc);

create index if not exists sync_jobs_type_created_idx
  on public.sync_jobs (job_type, created_at desc);

alter table public.products enable row level security;
alter table public.warehouses enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_transactions enable row level security;
alter table public.sync_jobs enable row level security;

drop policy if exists "public inventory products read" on public.products;
create policy "public inventory products read" on public.products
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public inventory warehouses read" on public.warehouses;
create policy "public inventory warehouses read" on public.warehouses
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public inventory balances read" on public.stock_balances;
create policy "public inventory balances read" on public.stock_balances
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public inventory transactions read" on public.stock_transactions;
create policy "public inventory transactions read" on public.stock_transactions
  for select
  to anon, authenticated
  using (true);

drop policy if exists "authenticated inventory products write" on public.products;
create policy "authenticated inventory products write" on public.products
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated inventory warehouses write" on public.warehouses;
create policy "authenticated inventory warehouses write" on public.warehouses
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated inventory balances write" on public.stock_balances;
create policy "authenticated inventory balances write" on public.stock_balances
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated inventory transactions write" on public.stock_transactions;
create policy "authenticated inventory transactions write" on public.stock_transactions
  for all
  to authenticated
  using (true)
  with check (true);

create or replace function public.adjust_website_stock(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_sku text := upper(trim(coalesce(p_payload ->> 'sku', '')));
  v_operation text := lower(trim(coalesce(p_payload ->> 'operation', 'add')));
  v_actor text := left(coalesce(p_payload ->> 'actor', 'Website'), 80);
  v_note text := left(coalesce(p_payload ->> 'note', ''), 500);
  v_source_text text := left(coalesce(p_payload ->> 'sourceText', ''), 500);
  v_created_at timestamptz := coalesce(nullif(p_payload ->> 'createdAt', '')::timestamptz, now());
  v_product_name text := left(coalesce(p_payload ->> 'name', v_sku), 500);
  v_allocation jsonb;
  v_warehouse_id bigint;
  v_warehouse_name text;
  v_input_quantity numeric(14, 2);
  v_before_quantity numeric(14, 2);
  v_after_quantity numeric(14, 2);
  v_delta_quantity numeric(14, 2);
  v_transaction_id text;
  v_allocations jsonb := '[]'::jsonb;
  v_transactions jsonb := '[]'::jsonb;
begin
  if v_sku = '' then
    raise exception 'Stock adjustment needs SKU.';
  end if;

  if v_operation not in ('add', 'set', 'subtract') then
    raise exception 'Invalid stock operation: %', v_operation;
  end if;

  if jsonb_typeof(coalesce(p_payload -> 'allocations', '[]'::jsonb)) <> 'array' then
    raise exception 'Stock adjustment needs allocations array.';
  end if;

  insert into public.products (sku, name, updated_at)
  values (v_sku, v_product_name, v_created_at)
  on conflict (sku) do update
  set
    name = case when excluded.name <> '' then excluded.name else public.products.name end,
    updated_at = excluded.updated_at;

  for v_allocation in
    select value from jsonb_array_elements(p_payload -> 'allocations')
  loop
    v_warehouse_id := nullif(v_allocation ->> 'warehouseId', '')::bigint;
    v_input_quantity := coalesce(nullif(v_allocation ->> 'quantity', '')::numeric, 0);

    if v_warehouse_id not in (491661, 491662) then
      raise exception 'Website stock can update only selected warehouses.';
    end if;

    if (v_operation = 'set' and v_input_quantity < 0) or (v_operation <> 'set' and v_input_quantity <= 0) then
      raise exception 'Stock quantity must be valid for operation %.', v_operation;
    end if;

    select name
    into v_warehouse_name
    from public.warehouses
    where id = v_warehouse_id;

    if v_warehouse_name is null then
      v_warehouse_name := case
        when v_warehouse_id = 491661 then 'คลัง ซ.เจริญกิจ'
        when v_warehouse_id = 491662 then 'คลัง สุขสวัสดิ์'
        else concat('Warehouse ', v_warehouse_id)
      end;

      insert into public.warehouses (id, name, api_name, label, source)
      values (
        v_warehouse_id,
        v_warehouse_name,
        replace(v_warehouse_name, ' ', ''),
        replace(v_warehouse_name, 'คลัง ', ''),
        'website'
      )
      on conflict (id) do update
      set
        name = excluded.name,
        updated_at = now();
    end if;

    perform pg_advisory_xact_lock(hashtext(v_sku || ':' || v_warehouse_id::text));

    select quantity
    into v_before_quantity
    from public.stock_balances
    where sku = v_sku and warehouse_id = v_warehouse_id
    for update;

    v_before_quantity := coalesce(v_before_quantity, 0);
    v_after_quantity := case
      when v_operation = 'set' then v_input_quantity
      when v_operation = 'subtract' then greatest(0, v_before_quantity - v_input_quantity)
      else v_before_quantity + v_input_quantity
    end;
    v_delta_quantity := v_after_quantity - v_before_quantity;
    v_transaction_id := concat(
      'stock-tx-',
      to_char(v_created_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISSMS"Z"'),
      '-',
      trim(both '-' from regexp_replace(v_sku, '[^A-Z0-9]+', '-', 'g')),
      '-',
      v_warehouse_id,
      '-',
      left(extensions.gen_random_uuid()::text, 8)
    );

    insert into public.stock_balances (
      sku,
      warehouse_id,
      quantity,
      waiting,
      wait_import,
      available,
      source,
      source_ref,
      manual_update_note,
      last_transaction_id,
      updated_at
    )
    values (
      v_sku,
      v_warehouse_id,
      v_after_quantity,
      0,
      0,
      v_after_quantity,
      'Website Stock',
      concat('Website Stock ', v_warehouse_name),
      coalesce(v_note, v_source_text, ''),
      v_transaction_id,
      v_created_at
    )
    on conflict (sku, warehouse_id) do update
    set
      quantity = excluded.quantity,
      available = excluded.available,
      manual_update_note = excluded.manual_update_note,
      last_transaction_id = excluded.last_transaction_id,
      updated_at = excluded.updated_at;

    insert into public.stock_transactions (
      id,
      created_at,
      sku,
      warehouse_id,
      operation,
      before_quantity,
      input_quantity,
      after_quantity,
      delta_quantity,
      actor,
      note,
      source_text,
      source
    )
    values (
      v_transaction_id,
      v_created_at,
      v_sku,
      v_warehouse_id,
      v_operation,
      v_before_quantity,
      v_input_quantity,
      v_after_quantity,
      v_delta_quantity,
      v_actor,
      v_note,
      v_source_text,
      'Website Stock'
    );

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'warehouseId', v_warehouse_id,
        'warehouseName', v_warehouse_name,
        'beforeQuantity', v_before_quantity,
        'afterQuantity', v_after_quantity,
        'transactionId', v_transaction_id
      )
    );

    v_transactions := v_transactions || jsonb_build_array(
      jsonb_build_object(
        'id', v_transaction_id,
        'createdAt', v_created_at,
        'sku', v_sku,
        'warehouseId', v_warehouse_id,
        'warehouseName', v_warehouse_name,
        'operation', v_operation,
        'beforeQuantity', v_before_quantity,
        'inputQuantity', v_input_quantity,
        'afterQuantity', v_after_quantity,
        'deltaQuantity', v_delta_quantity,
        'actor', v_actor,
        'note', v_note,
        'sourceText', v_source_text,
        'source', 'Website Stock'
      )
    );
  end loop;

  if jsonb_array_length(v_allocations) = 0 then
    raise exception 'Stock adjustment needs at least one allocation.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'result', jsonb_build_object(
      'ok', true,
      'sku', v_sku,
      'operation', v_operation,
      'allocations', v_allocations,
      'transactions', v_transactions,
      'exportedAt', v_created_at
    ),
    'message', concat('บันทึก stock SKU ', v_sku, ' สำเร็จบน Supabase')
  );
end;
$$;

revoke all on function public.adjust_website_stock(jsonb) from public;
grant execute on function public.adjust_website_stock(jsonb) to authenticated;
grant execute on function public.adjust_website_stock(jsonb) to service_role;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_snapshots (
  key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.expense_records (
  id text primary key,
  expense_no text not null default '',
  wht_no text not null default '',
  payment_date date not null default current_date,
  recipient_name text not null,
  recipient_tax_id text not null default '',
  recipient_address text not null default '',
  recipient_type text not null check (recipient_type in ('individual', 'company')),
  pnd_type text not null check (pnd_type in ('PND3', 'PND53')),
  category text not null default '',
  description text not null default '',
  invoice_no text not null default '',
  notes text not null default '',
  amount_input numeric(14, 2) not null default 0 check (amount_input >= 0),
  amount_mode text not null default 'exclusive' check (amount_mode in ('exclusive', 'inclusive')),
  vat_mode text not null default 'none' check (vat_mode in ('vat7', 'none', 'exempt')),
  vat_rate numeric(5, 2) not null default 0,
  wht_rate numeric(5, 2) not null default 0 check (wht_rate in (0, 1, 2, 3, 5)),
  subtotal numeric(14, 2) not null default 0,
  vat_amount numeric(14, 2) not null default 0,
  gross_amount numeric(14, 2) not null default 0,
  withholding_base numeric(14, 2) not null default 0,
  withholding_amount numeric(14, 2) not null default 0,
  net_payable numeric(14, 2) not null default 0,
  status text not null default 'posted' check (status in ('draft', 'posted', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expense_records_payment_date_idx
  on public.expense_records (payment_date desc);

create index if not exists expense_records_pnd_payment_date_idx
  on public.expense_records (pnd_type, payment_date desc);

create index if not exists expense_records_status_idx
  on public.expense_records (status);

create table if not exists public.packhai_stock_movements (
  movement_key text primary key,
  stock_shop_id bigint not null,
  sku text not null default '',
  created_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists packhai_stock_movements_stock_shop_created_idx
  on public.packhai_stock_movements (stock_shop_id, created_at desc);

create index if not exists packhai_stock_movements_sku_idx
  on public.packhai_stock_movements (sku);

alter table public.app_snapshots enable row level security;
alter table public.expense_records enable row level security;
alter table public.packhai_stock_movements enable row level security;

drop policy if exists "public app snapshots read" on public.app_snapshots;
create policy "public app snapshots read" on public.app_snapshots
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public expense records read" on public.expense_records;
create policy "public expense records read" on public.expense_records
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public packhai stock movements read" on public.packhai_stock_movements;
create policy "public packhai stock movements read" on public.packhai_stock_movements
  for select
  to anon, authenticated
  using (true);

create or replace function public.dashboard_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'dashboard', coalesce((select payload from public.app_snapshots where key = 'dashboard_current'), '{}'::jsonb),
    'stockMovements', coalesce((select payload from public.app_snapshots where key = 'stock_movements_current'), '{}'::jsonb),
    'sellerPayments', coalesce((select payload from public.app_snapshots where key = 'seller_payments_current'), '{}'::jsonb),
    'sourceFiles', coalesce((select payload from public.app_snapshots where key = 'source_files_current'), '{}'::jsonb),
    'websiteStock', public.website_stock_snapshot(500)
  );
$$;

create or replace function public.stock_movements_for_stock_shop_ids(
  p_stock_shop_ids bigint[],
  p_limit_per_item integer default 500
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select
      stock_shop_id,
      payload,
      created_at,
      row_number() over (partition by stock_shop_id order by created_at desc nulls last, movement_key desc) as rn
    from public.packhai_stock_movements
    where stock_shop_id = any(coalesce(p_stock_shop_ids, '{}'::bigint[]))
  )
  select jsonb_build_object(
    'ok', true,
    'rows', coalesce(jsonb_agg(payload order by created_at desc nulls last), '[]'::jsonb)
  )
  from ranked
  where rn <= greatest(1, least(coalesce(p_limit_per_item, 500), 2000));
$$;

create or replace function public.expense_record_json(e public.expense_records)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'expenseNo', e.expense_no,
    'whtNo', e.wht_no,
    'paymentDate', to_char(e.payment_date, 'YYYY-MM-DD'),
    'recipientName', e.recipient_name,
    'recipientTaxId', e.recipient_tax_id,
    'recipientAddress', e.recipient_address,
    'recipientType', e.recipient_type,
    'pndType', e.pnd_type,
    'category', e.category,
    'description', e.description,
    'invoiceNo', e.invoice_no,
    'notes', e.notes,
    'amountInput', e.amount_input,
    'amountMode', e.amount_mode,
    'vatMode', e.vat_mode,
    'vatRate', e.vat_rate,
    'whtRate', e.wht_rate,
    'subtotal', e.subtotal,
    'vatAmount', e.vat_amount,
    'grossAmount', e.gross_amount,
    'withholdingBase', e.withholding_base,
    'withholdingAmount', e.withholding_amount,
    'netPayable', e.net_payable,
    'status', e.status,
    'createdAt', e.created_at,
    'updatedAt', e.updated_at
  );
$$;

create or replace function public.expense_summary(p_month text default null, p_pnd_type text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'month', coalesce(p_month, ''),
    'count', count(*)::int,
    'pnd3Count', count(*) filter (where pnd_type = 'PND3')::int,
    'pnd53Count', count(*) filter (where pnd_type = 'PND53')::int,
    'subtotal', coalesce(round(sum(subtotal), 2), 0),
    'vatAmount', coalesce(round(sum(vat_amount), 2), 0),
    'grossAmount', coalesce(round(sum(gross_amount), 2), 0),
    'withholdingAmount', coalesce(round(sum(withholding_amount), 2), 0),
    'netPayable', coalesce(round(sum(net_payable), 2), 0)
  )
  from public.expense_records
  where status <> 'cancelled'
    and (p_month is null or p_month = '' or to_char(payment_date, 'YYYY-MM') = p_month)
    and (p_pnd_type is null or p_pnd_type = '' or pnd_type = p_pnd_type);
$$;

create or replace function public.list_expenses(p_month text default null, p_pnd_type text default null)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with rows as (
    select *
    from public.expense_records
    where (p_month is null or p_month = '' or to_char(payment_date, 'YYYY-MM') = p_month)
      and (p_pnd_type is null or p_pnd_type = '' or pnd_type = p_pnd_type)
    order by payment_date desc, expense_no desc, created_at desc
  )
  select jsonb_build_object(
    'ok', true,
    'updatedAt', coalesce((select max(updated_at) from rows), now()),
    'month', coalesce(p_month, ''),
    'summary', public.expense_summary(p_month, p_pnd_type),
    'pnd3Summary', public.expense_summary(p_month, 'PND3'),
    'pnd53Summary', public.expense_summary(p_month, 'PND53'),
    'expenses', coalesce(jsonb_agg(public.expense_record_json(rows.*)), '[]'::jsonb)
  )
  from rows;
$$;

create or replace function public.next_expense_number(p_prefix text, p_field text, p_date date)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_month text := to_char(p_date, 'YYYYMM');
  v_match text := p_prefix || '-' || v_month || '-';
  v_max integer := 0;
begin
  if p_field = 'wht_no' then
    select coalesce(max(nullif(replace(wht_no, v_match, ''), '')::integer), 0)
    into v_max
    from public.expense_records
    where wht_no like v_match || '%';
  else
    select coalesce(max(nullif(replace(expense_no, v_match, ''), '')::integer), 0)
    into v_max
    from public.expense_records
    where expense_no like v_match || '%';
  end if;

  return v_match || lpad((v_max + 1)::text, 4, '0');
end;
$$;

create or replace function public.create_expense(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_payment_date date := coalesce(nullif(p_payload ->> 'paymentDate', '')::date, current_date);
  v_recipient_type text := case when p_payload ->> 'recipientType' = 'individual' then 'individual' else 'company' end;
  v_recipient_name text := left(trim(coalesce(p_payload ->> 'recipientName', '')), 240);
  v_amount_input numeric(14, 2) := coalesce(nullif(p_payload ->> 'amountInput', '')::numeric, 0);
  v_amount_mode text := case when p_payload ->> 'amountMode' = 'inclusive' then 'inclusive' else 'exclusive' end;
  v_vat_mode text := case when p_payload ->> 'vatMode' in ('vat7', 'exempt') then p_payload ->> 'vatMode' else 'none' end;
  v_wht_rate numeric(5, 2) := case when coalesce(nullif(p_payload ->> 'whtRate', '')::numeric, 0) in (0, 1, 2, 3, 5) then coalesce(nullif(p_payload ->> 'whtRate', '')::numeric, 0) else 0 end;
  v_subtotal numeric(14, 2) := v_amount_input;
  v_vat_amount numeric(14, 2) := 0;
  v_gross_amount numeric(14, 2) := v_amount_input;
  v_withholding_amount numeric(14, 2) := 0;
  v_net_payable numeric(14, 2) := 0;
  v_id text := coalesce(nullif(p_payload ->> 'id', ''), 'exp_' || replace(extensions.gen_random_uuid()::text, '-', ''));
  v_expense_no text;
  v_wht_no text := '';
  v_record public.expense_records;
  v_state jsonb;
begin
  if v_recipient_name = '' then
    raise exception 'Recipient name is required.';
  end if;
  if v_amount_input <= 0 then
    raise exception 'Expense amount must be greater than zero.';
  end if;

  if v_vat_mode = 'vat7' then
    if v_amount_mode = 'inclusive' then
      v_gross_amount := round(v_amount_input, 2);
      v_subtotal := round(v_gross_amount / 1.07, 2);
      v_vat_amount := round(v_gross_amount - v_subtotal, 2);
    else
      v_subtotal := round(v_amount_input, 2);
      v_vat_amount := round(v_subtotal * 0.07, 2);
      v_gross_amount := round(v_subtotal + v_vat_amount, 2);
    end if;
  end if;

  v_withholding_amount := round(v_subtotal * (v_wht_rate / 100), 2);
  v_net_payable := round(v_gross_amount - v_withholding_amount, 2);
  v_expense_no := coalesce(nullif(p_payload ->> 'expenseNo', ''), public.next_expense_number('EXP', 'expense_no', v_payment_date));
  if v_withholding_amount > 0 then
    v_wht_no := coalesce(nullif(p_payload ->> 'whtNo', ''), public.next_expense_number('WHT', 'wht_no', v_payment_date));
  end if;

  insert into public.expense_records (
    id, expense_no, wht_no, payment_date, recipient_name, recipient_tax_id, recipient_address,
    recipient_type, pnd_type, category, description, invoice_no, notes, amount_input,
    amount_mode, vat_mode, vat_rate, wht_rate, subtotal, vat_amount, gross_amount,
    withholding_base, withholding_amount, net_payable, status
  )
  values (
    v_id,
    v_expense_no,
    v_wht_no,
    v_payment_date,
    v_recipient_name,
    left(coalesce(p_payload ->> 'recipientTaxId', ''), 40),
    left(coalesce(p_payload ->> 'recipientAddress', ''), 500),
    v_recipient_type,
    case when v_recipient_type = 'individual' then 'PND3' else 'PND53' end,
    left(coalesce(nullif(p_payload ->> 'category', ''), 'General Expense'), 120),
    left(coalesce(nullif(p_payload ->> 'description', ''), coalesce(p_payload ->> 'category', 'Expense')), 240),
    left(coalesce(p_payload ->> 'invoiceNo', ''), 120),
    left(coalesce(p_payload ->> 'notes', ''), 1000),
    v_amount_input,
    v_amount_mode,
    v_vat_mode,
    case when v_vat_mode = 'vat7' then 7 else 0 end,
    v_wht_rate,
    v_subtotal,
    v_vat_amount,
    v_gross_amount,
    v_subtotal,
    v_withholding_amount,
    v_net_payable,
    case when p_payload ->> 'status' = 'draft' then 'draft' else 'posted' end
  )
  returning * into v_record;

  v_state := public.list_expenses(to_char(v_payment_date, 'YYYY-MM'), null);
  return v_state || jsonb_build_object('record', public.expense_record_json(v_record));
end;
$$;

create or replace function public.cancel_expense(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.expense_records;
  v_state jsonb;
begin
  update public.expense_records
  set status = 'cancelled',
      updated_at = now()
  where id = p_id
  returning * into v_record;

  if v_record.id is null then
    raise exception 'Expense not found.';
  end if;

  v_state := public.list_expenses(to_char(v_record.payment_date, 'YYYY-MM'), null);
  return v_state || jsonb_build_object('record', public.expense_record_json(v_record));
end;
$$;

revoke all on function public.dashboard_state() from public;
revoke all on function public.expense_record_json(public.expense_records) from public;
revoke all on function public.expense_summary(text, text) from public;
revoke all on function public.list_expenses(text, text) from public;
revoke all on function public.stock_movements_for_stock_shop_ids(bigint[], integer) from public;
revoke all on function public.next_expense_number(text, text, date) from public;
revoke all on function public.create_expense(jsonb) from public;
revoke all on function public.cancel_expense(text) from public;

grant execute on function public.dashboard_state() to anon, authenticated, service_role;
grant execute on function public.expense_record_json(public.expense_records) to anon, authenticated, service_role;
grant execute on function public.expense_summary(text, text) to anon, authenticated, service_role;
grant execute on function public.list_expenses(text, text) to anon, authenticated, service_role;
grant execute on function public.stock_movements_for_stock_shop_ids(bigint[], integer) to anon, authenticated, service_role;
grant execute on function public.create_expense(jsonb) to anon, authenticated, service_role;
grant execute on function public.cancel_expense(text) to anon, authenticated, service_role;

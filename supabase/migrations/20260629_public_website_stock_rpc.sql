create or replace function public.website_stock_snapshot(p_transaction_limit integer default 500)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with balance_rows as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sku', b.sku,
            'name', coalesce(nullif(p.name, ''), b.sku),
            'barcode', coalesce(p.barcode, ''),
            'prop', coalesce(p.prop, ''),
            'productId', coalesce(p.product_id, ''),
            'productMasterId', coalesce(p.product_master_id, ''),
            'quantity', b.quantity,
            'waiting', b.waiting,
            'waitImport', b.wait_import,
            'available', b.available,
            'warehouseId', b.warehouse_id,
            'warehouseName', coalesce(w.name, concat('Warehouse ', b.warehouse_id::text)),
            'source', coalesce(nullif(b.source_ref, ''), concat('Website Stock ', coalesce(w.name, ''))),
            'manualUpdateNote', b.manual_update_note,
            'lastTransactionId', b.last_transaction_id,
            'updatedAt', b.updated_at
          )
          order by b.updated_at desc, b.sku, b.warehouse_id
        ),
        '[]'::jsonb
      ) as rows
    from public.stock_balances b
    left join public.products p on p.sku = b.sku
    left join public.warehouses w on w.id = b.warehouse_id
    where b.warehouse_id in (491661, 491662)
  ),
  transaction_rows as (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'createdAt', t.created_at,
            'sku', t.sku,
            'warehouseId', t.warehouse_id,
            'warehouseName', coalesce(w.name, concat('Warehouse ', t.warehouse_id::text)),
            'operation', t.operation,
            'beforeQuantity', t.before_quantity,
            'inputQuantity', t.input_quantity,
            'afterQuantity', t.after_quantity,
            'deltaQuantity', t.delta_quantity,
            'actor', t.actor,
            'note', t.note,
            'sourceText', t.source_text,
            'source', t.source
          )
          order by t.created_at desc
        ),
        '[]'::jsonb
      ) as stock_transactions
    from (
      select *
      from public.stock_transactions
      where warehouse_id in (491661, 491662)
      order by created_at desc
      limit greatest(1, least(coalesce(p_transaction_limit, 500), 2000))
    ) t
    left join public.warehouses w on w.id = t.warehouse_id
  )
  select jsonb_build_object(
    'ok', true,
    'exportedAt', now(),
    'source', 'Supabase Website Stock',
    'rows', balance_rows.rows,
    'stockTransactions', transaction_rows.stock_transactions
  )
  from balance_rows, transaction_rows;
$$;

revoke all on function public.website_stock_snapshot(integer) from public;
grant execute on function public.website_stock_snapshot(integer) to anon;
grant execute on function public.website_stock_snapshot(integer) to authenticated;
grant execute on function public.website_stock_snapshot(integer) to service_role;

grant execute on function public.adjust_website_stock(jsonb) to anon;

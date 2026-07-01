alter table public.plain_design_products
  drop constraint if exists plain_design_products_status_check;

update public.plain_design_products
set status = case status
  when 'not_started' then 'waiting_ai_images'
  when 'designing' then 'waiting_ai_images'
  when 'review' then 'ai_done_waiting_review'
  when 'approved' then 'passed'
  when 'factory_ready' then 'passed'
  else status
end;

alter table public.plain_design_products
  alter column status set default 'waiting_ai_images';

alter table public.plain_design_products
  add constraint plain_design_products_status_check
  check (status in ('passed', 'ai_done_waiting_review', 'needs_ai_revision', 'waiting_ai_images'));

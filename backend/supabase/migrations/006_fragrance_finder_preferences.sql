-- Phase 3A. Apply through the normal reviewed migration process; never from the storefront.
begin;

create table if not exists public.fragrance_finder_preferences (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key in ('fresh','sweet','woody','oud','spicy','floral')),
  label text not null,
  descriptors text not null default '',
  copy text not null default '',
  icon_key text not null,
  product_id uuid references public.products(id) on delete set null,
  active boolean not null default true,
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fragrance_finder_preferences_display_order_key
  on public.fragrance_finder_preferences(display_order);

drop trigger if exists fragrance_finder_preferences_set_updated_at on public.fragrance_finder_preferences;
create trigger fragrance_finder_preferences_set_updated_at
before update on public.fragrance_finder_preferences
for each row execute function public.set_updated_at();

alter table public.fragrance_finder_preferences enable row level security;
revoke all on public.fragrance_finder_preferences from anon, authenticated;
grant select, insert, update, delete on public.fragrance_finder_preferences to service_role;

-- Presentation copy is the already-approved Finder copy. Assignments are deliberately empty.
insert into public.fragrance_finder_preferences
  (key, label, descriptors, copy, icon_key, product_id, active, display_order)
values
  ('fresh', 'Fresh', 'Fresh • Aromatic • Refined',
   'A bright, polished fragrance selected for effortless everyday confidence.', 'sparkles', null, true, 1),
  ('sweet', 'Sweet', 'Sweet • Amber • Radiant',
   'A luxurious, glowing oriental composition with sweet amber warmth and radiant crystalline depth.', 'candy', null, true, 2),
  ('woody', 'Woody', 'Woody • Smoky • Intense',
   'A commanding, dark woods fragrance layered with deep amber and polished evening charisma.', 'tree-pine', null, true, 3),
  ('oud', 'Oud', 'Resinous • Smoky • Bold',
   'A bold, distinguished profile shaped by rich balsamic woods and commanding royal depth.', 'droplets', null, true, 4),
  ('spicy', 'Spicy', 'Warm Spicy • Amber • Sophisticated',
   'An evocative signature blend balancing vibrant spice with velvety amber warmth and modern presence.', 'flame', null, true, 5),
  ('floral', 'Floral', 'Floral • Delicate • Luminous',
   'An exquisite bouquet of blooming florals elevated by soft citrus brightness and velvet musk.', 'flower-2', null, true, 6)
on conflict (key) do nothing;

commit;

-- Migration: 005_product_card_presentation.sql
-- Description: Add cardImage, cardHoverImage, and cardBackgroundColor columns to public.products for Concept 7 Product Card presentation

alter table public.products
  add column if not exists card_image_url text not null default '',
  add column if not exists card_hover_image_url text not null default '',
  add column if not exists card_background_color text not null default '#E7C78F';

comment on column public.products.card_image_url is 'Transparent PNG/WebP bottle artwork for default ProductCard presentation';
comment on column public.products.card_hover_image_url is 'Editorial/photoshoot lifestyle image revealed on ProductCard hover';
comment on column public.products.card_background_color is 'Solid background HEX color for the ProductCard media container';

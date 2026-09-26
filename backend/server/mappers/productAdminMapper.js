const FIELD_TO_COLUMN = Object.freeze({
  name: 'name', slug: 'slug', sku: 'sku', shortDescription: 'short_description',
  description: 'description', price: 'price', salePrice: 'sale_price',
  oldPrice: 'old_price', stockQuantity: 'stock_quantity', categoryId: 'category_id',
  collection: 'collection', gender: 'gender', scentFamily: 'scent_family',
  bottleSize: 'bottle_size', concentration: 'concentration', longevity: 'longevity',
  sillage: 'sillage', occasion: 'occasion', inspiredBy: 'inspired_by',
  image: 'main_image_url', gallery: 'gallery_urls', imageAlt: 'image_alt',
  badge: 'badge', tags: 'tags', sizeOptions: 'size_options',
  variations: 'variations', isFeatured: 'is_featured',
  isBestSeller: 'is_best_seller', isNewArrival: 'is_new_arrival',
  isPremium: 'is_premium', isAttar: 'is_attar', status: 'status',
  seoTitle: 'seo_title', seoDescription: 'seo_description',
  cardImage: 'card_image_url', cardHoverImage: 'card_hover_image_url',
  cardBackgroundColor: 'card_background_color',
})

export function toProductColumns(input) {
  const columns = {}
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (Object.hasOwn(input, field)) columns[column] = input[field]
  }
  if (Object.hasOwn(input, 'notes')) {
    columns.top_notes = input.notes.top
    columns.middle_notes = input.notes.middle
    columns.base_notes = input.notes.base
  }
  return columns
}

export function toProductDto(row) {
  const dto = { id: row.id }
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    dto[field] = ['price', 'salePrice', 'oldPrice'].includes(field) && row[column] != null
      ? Number(row[column]) : row[column]
  }
  dto.category = row.category_name
  dto.notes = { top: row.top_notes, middle: row.middle_notes, base: row.base_notes }
  dto.stockStatus = row.stock_status
  dto.active = row.active
  dto.publishedAt = row.published_at
  dto.createdAt = row.created_at
  dto.updatedAt = row.updated_at
  return dto
}

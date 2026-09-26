export function toCategoryDto(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    image: row.image_url ?? '',
    imageUrl: row.image_url ?? '',
    displayOrder: row.display_order ?? 0,
    showOnHomepage: Boolean(row.show_on_homepage),
    status: row.status ?? 'Published',
    active: Boolean(row.active),
    seoTitle: row.seo_title ?? '',
    seoDescription: row.seo_description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCategoryColumns(dto) {
  const columns = {}
  if (dto.name !== undefined) columns.name = dto.name
  if (dto.slug !== undefined) columns.slug = dto.slug
  if (dto.description !== undefined) columns.description = dto.description
  if (dto.imageUrl !== undefined) columns.image_url = dto.imageUrl
  if (dto.displayOrder !== undefined) columns.display_order = dto.displayOrder
  if (dto.showOnHomepage !== undefined) columns.show_on_homepage = dto.showOnHomepage
  if (dto.status !== undefined) columns.status = dto.status
  if (dto.active !== undefined) columns.active = dto.active
  if (dto.seoTitle !== undefined) columns.seo_title = dto.seoTitle
  if (dto.seoDescription !== undefined) columns.seo_description = dto.seoDescription
  return columns
}

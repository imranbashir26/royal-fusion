export function toCollectionDto(row) {
  if (!row) return null
  const active = Boolean(row.active)
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    active,
    status: active ? 'Published' : 'Archived',
    displayOrder: row.display_order ?? 0,
    featured: Boolean(row.featured),
    bannerCloudinaryPublicId: row.banner_cloudinary_public_id ?? '',
    bannerSecureUrl: row.banner_secure_url ?? '',
    bannerAltText: row.banner_alt_text ?? '',
    image: row.banner_secure_url ?? '',
    imageUrl: row.banner_secure_url ?? '',
    seoTitle: row.seo_title ?? '',
    seoDescription: row.seo_description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toCollectionColumns(dto) {
  const columns = {}
  if (dto.name !== undefined) columns.name = dto.name
  if (dto.slug !== undefined) columns.slug = dto.slug
  if (dto.description !== undefined) columns.description = dto.description
  if (dto.active !== undefined) columns.active = dto.active
  if (dto.displayOrder !== undefined) columns.display_order = dto.displayOrder
  if (dto.featured !== undefined) columns.featured = dto.featured
  if (dto.bannerCloudinaryPublicId !== undefined) {
    columns.banner_cloudinary_public_id = dto.bannerCloudinaryPublicId
  }
  if (dto.bannerSecureUrl !== undefined) {
    columns.banner_secure_url = dto.bannerSecureUrl
  }
  if (dto.bannerAltText !== undefined) {
    columns.banner_alt_text = dto.bannerAltText
  }
  if (dto.seoTitle !== undefined) columns.seo_title = dto.seoTitle
  if (dto.seoDescription !== undefined) columns.seo_description = dto.seoDescription
  return columns
}

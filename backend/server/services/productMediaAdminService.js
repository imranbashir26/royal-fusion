import { validateImageFile, MediaSecurityError } from '../utils/imageSecurity.js'
import { CloudinaryServiceError } from './cloudinaryService.js'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export class MediaApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const VALID_MEDIA_TYPES = new Set(['main', 'gallery', 'card', 'cardHover'])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ProductMediaAdminService {
  constructor(client, cloudinaryService, logger = console, tokenSecret = '') {
    this.client = client
    this.cloudinaryService = cloudinaryService
    this.logger = logger
    this.tokenSecret = tokenSecret
  }

  requireClient() {
    if (!this.client) {
      throw new MediaApiError(503, 'MEDIA_SERVICE_UNAVAILABLE', 'Database service is unavailable.')
    }
    return this.client
  }

  async uploadProductMedia({
    productId,
    mediaType,
    file,
    altText = '',
    displayOrder,
    actor,
  }) {
    if (productId && !UUID_REGEX.test(productId)) {
      throw new MediaApiError(400, 'INVALID_REQUEST', 'Product ID is missing or invalid.')
    }

    if (!VALID_MEDIA_TYPES.has(mediaType)) {
      throw new MediaApiError(
        400,
        'INVALID_MEDIA_TYPE',
        `Media type must be one of: ${Array.from(VALID_MEDIA_TYPES).join(', ')}.`
      )
    }

    if (!file || !file.buffer) {
      throw new MediaApiError(400, 'MISSING_FILE', 'No image file was provided.')
    }

    try {
      validateImageFile({
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      })
    } catch (err) {
      if (err instanceof MediaSecurityError) {
        throw new MediaApiError(err.status, err.code, err.message)
      }
      throw err
    }

    const client = this.requireClient()

    if (!productId) {
      if (!actor?.userId || !this.tokenSecret) {
        throw new MediaApiError(503, 'MEDIA_SERVICE_UNAVAILABLE', 'Staged uploads are unavailable.')
      }
      const draftId = randomUUID()
      const upload = await this.uploadToCloudinary(file, `drafts/${draftId}`, mediaType)
      const media = { ...upload, mediaType, productId: null }
      await this.audit('product_media.stage', { productId: draftId, publicId: upload.publicId, secureUrl: upload.secureUrl, mediaType }, actor)
      return {
        ...media,
        uploadToken: this.signStagedMedia({
          publicId: upload.publicId,
          secureUrl: upload.secureUrl,
          mediaType,
          userId: actor.userId,
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        }),
      }
    }

    // 1. Verify product exists
    const { data: product, error: productError } = await client
      .from('products')
      .select('id, name, main_image_url, gallery_urls, card_image_url, card_hover_image_url')
      .eq('id', productId)
      .maybeSingle()

    if (productError) throw databaseError(productError)
    if (!product) throw new MediaApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.')

    // 2. Identify superseded asset if slot is a single-asset slot (main, card, cardHover)
    let previousPublicId = null
    if (mediaType === 'main' || mediaType === 'card' || mediaType === 'cardHover') {
      const priorUrl =
        mediaType === 'main'
          ? product.main_image_url
          : mediaType === 'card'
            ? product.card_image_url
            : product.card_hover_image_url

      if (priorUrl) {
        const { data: priorMedia } = await client
          .from('product_media')
          .select('cloudinary_public_id')
          .eq('product_id', productId)
          .eq('secure_url', priorUrl)
          .maybeSingle()

        if (priorMedia?.cloudinary_public_id) {
          previousPublicId = priorMedia.cloudinary_public_id
        }
      }
    }

    // 3. Upload to Cloudinary
    const uploadResult = await this.uploadToCloudinary(file, productId, mediaType)

    const { secureUrl, publicId, width, height, format } = uploadResult

    // 4. Persist to database (product_media + products)
    try {
      if (mediaType === 'main') {
        // Delete superseded primary records for this product
        await client
          .from('product_media')
          .delete()
          .eq('product_id', productId)
          .eq('is_primary', true)

        // Insert new primary record
        const { error: insertError } = await client.from('product_media').insert({
          product_id: productId,
          cloudinary_public_id: publicId,
          secure_url: secureUrl,
          alt_text: altText || `${product.name || 'Product'} main image`,
          media_type: 'image',
          display_order: 0,
          is_primary: true,
        })
        if (insertError) throw insertError

        // Update product's main_image_url
        const { error: prodUpdateError } = await client
          .from('products')
          .update({ main_image_url: secureUrl, updated_at: new Date().toISOString() })
          .eq('id', productId)
        if (prodUpdateError) throw prodUpdateError
      } else if (mediaType === 'card') {
        if (product.card_image_url) {
          await client
            .from('product_media')
            .delete()
            .eq('product_id', productId)
            .eq('secure_url', product.card_image_url)
        }

        // Insert card media record
        const { error: insertError } = await client.from('product_media').insert({
          product_id: productId,
          cloudinary_public_id: publicId,
          secure_url: secureUrl,
          alt_text: altText || 'Card presentation image',
          media_type: 'image',
          display_order: 0,
          is_primary: false,
        })
        if (insertError) throw insertError

        // Update product's card_image_url
        const { error: prodUpdateError } = await client
          .from('products')
          .update({ card_image_url: secureUrl, updated_at: new Date().toISOString() })
          .eq('id', productId)
        if (prodUpdateError) throw prodUpdateError
      } else if (mediaType === 'cardHover') {
        if (product.card_hover_image_url) {
          await client
            .from('product_media')
            .delete()
            .eq('product_id', productId)
            .eq('secure_url', product.card_hover_image_url)
        }

        // Insert card hover media record
        const { error: insertError } = await client.from('product_media').insert({
          product_id: productId,
          cloudinary_public_id: publicId,
          secure_url: secureUrl,
          alt_text: altText || 'Card hover image',
          media_type: 'image',
          display_order: 0,
          is_primary: false,
        })
        if (insertError) throw insertError

        // Update product's card_hover_image_url
        const { error: prodUpdateError } = await client
          .from('products')
          .update({ card_hover_image_url: secureUrl, updated_at: new Date().toISOString() })
          .eq('id', productId)
        if (prodUpdateError) throw prodUpdateError
      } else if (mediaType === 'gallery') {
        const currentGallery = Array.isArray(product.gallery_urls) ? product.gallery_urls : []
        const nextOrder = typeof displayOrder === 'number' ? displayOrder : currentGallery.length

        // Insert gallery media record
        const { error: insertError } = await client.from('product_media').insert({
          product_id: productId,
          cloudinary_public_id: publicId,
          secure_url: secureUrl,
          alt_text: altText || `${product.name || 'Product'} gallery image`,
          media_type: 'image',
          display_order: nextOrder,
          is_primary: false,
        })
        if (insertError) throw insertError

        // Update product's gallery array
        const updatedGallery = [...currentGallery, secureUrl]
        const { error: prodUpdateError } = await client
          .from('products')
          .update({ gallery_urls: updatedGallery, updated_at: new Date().toISOString() })
          .eq('id', productId)
        if (prodUpdateError) throw prodUpdateError
      }
    } catch (dbErr) {
      throw databaseError(dbErr)
    }

    // 5. Lifecycle replacement: clean up superseded asset only after successful database commit
    if (previousPublicId && previousPublicId !== publicId) {
      try {
        // Check if previous asset is still referenced in product_media
        const { data: refs } = await client
          .from('product_media')
          .select('id')
          .eq('cloudinary_public_id', previousPublicId)

        if (!refs || refs.length === 0) {
          await this.cloudinaryService.deleteImage(previousPublicId)
        }
      } catch (cleanupErr) {
        this.logger.warn?.({
          event: 'media.replacement_cleanup_failed',
          previousPublicId,
          message: cleanupErr.message,
        })
      }
    }

    // 6. Audit logging
    const action = previousPublicId ? 'product_media.replace' : 'product_media.upload'
    await this.audit(action, {
      productId,
      publicId,
      secureUrl,
      mediaType,
      previousPublicId,
    }, actor)

    return {
      url: secureUrl,
      secureUrl,
      publicId,
      mediaType,
      width,
      height,
      format,
      productId,
    }
  }

  async uploadToCloudinary(file, productId, mediaType) {
    try {
      const result = await this.cloudinaryService.uploadImageBuffer(file.buffer, { productId, mediaType })
      if (!/^https:\/\/res\.cloudinary\.com\//.test(result.secureUrl || '')) {
        throw new MediaApiError(502, 'INVALID_MEDIA_URL', 'Media provider did not return a secure Cloudinary URL.')
      }
      return result
    } catch (err) {
      if (err instanceof CloudinaryServiceError || err instanceof MediaApiError) throw err
      throw new MediaApiError(
        err.status || 500,
        err.code || 'CLOUDINARY_UPLOAD_FAILED',
        err.message || 'Image upload to media provider failed.'
      )
    }
  }

  signStagedMedia(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', this.tokenSecret).update(data).digest('base64url')
    return `${data}.${signature}`
  }

  verifyStagedMedia(uploadToken, actor) {
    if (typeof uploadToken !== 'string' || uploadToken.length > 4096 || !this.tokenSecret) {
      throw new MediaApiError(400, 'INVALID_UPLOAD_TOKEN', 'Staged upload token is invalid.')
    }
    const [data, signature, extra] = uploadToken.split('.')
    if (!data || !signature || extra) {
      throw new MediaApiError(400, 'INVALID_UPLOAD_TOKEN', 'Staged upload token is invalid.')
    }
    const expected = createHmac('sha256', this.tokenSecret).update(data).digest()
    let provided
    try { provided = Buffer.from(signature, 'base64url') } catch { provided = Buffer.alloc(0) }
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new MediaApiError(403, 'INVALID_UPLOAD_TOKEN', 'Staged upload token is invalid.')
    }
    let payload
    try { payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) } catch {
      throw new MediaApiError(400, 'INVALID_UPLOAD_TOKEN', 'Staged upload token is invalid.')
    }
    if (payload.userId !== actor?.userId || payload.expiresAt < Date.now() ||
      !/^royal-fusion\/products\/drafts\/[0-9a-f-]{36}\//.test(payload.publicId || '') ||
      !/^https:\/\/res\.cloudinary\.com\//.test(payload.secureUrl || '') ||
      !VALID_MEDIA_TYPES.has(payload.mediaType)) {
      throw new MediaApiError(403, 'INVALID_UPLOAD_TOKEN', 'Staged upload token is invalid or expired.')
    }
    return payload
  }

  async claimStagedMedia({ productId, uploadToken, actor }) {
    if (!UUID_REGEX.test(productId || '')) {
      throw new MediaApiError(400, 'INVALID_REQUEST', 'Product ID is missing or invalid.')
    }
    const staged = this.verifyStagedMedia(uploadToken, actor)
    const client = this.requireClient()
    const { data: product, error } = await client.from('products')
      .select('id, main_image_url, gallery_urls, card_image_url, card_hover_image_url')
      .eq('id', productId).maybeSingle()
    if (error) throw databaseError(error)
    if (!product) throw new MediaApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.')
    const referenced = staged.mediaType === 'main'
      ? product.main_image_url === staged.secureUrl
      : staged.mediaType === 'card'
        ? product.card_image_url === staged.secureUrl
        : staged.mediaType === 'cardHover'
          ? product.card_hover_image_url === staged.secureUrl
          : Array.isArray(product.gallery_urls) && product.gallery_urls.includes(staged.secureUrl)
    if (!referenced) throw new MediaApiError(400, 'MEDIA_NOT_REFERENCED', 'Product does not reference this upload.')
    const { data: existing, error: lookupError } = await client.from('product_media')
      .select('id, product_id').eq('cloudinary_public_id', staged.publicId).maybeSingle()
    if (lookupError) throw databaseError(lookupError)
    if (existing) {
      if (existing.product_id !== productId) throw new MediaApiError(409, 'MEDIA_ALREADY_CLAIMED', 'Media is already attached.')
      return { success: true, productId, secureUrl: staged.secureUrl }
    }
    const { error: insertError } = await client.from('product_media').insert({
      product_id: productId,
      cloudinary_public_id: staged.publicId,
      secure_url: staged.secureUrl,
      alt_text: '',
      media_type: 'image',
      display_order: Array.isArray(product.gallery_urls) ? Math.max(product.gallery_urls.indexOf(staged.secureUrl), 0) : 0,
      is_primary: product.main_image_url === staged.secureUrl,
    })
    if (insertError?.code === '23505') {
      const { data: claimed, error: retryLookupError } = await client.from('product_media')
        .select('product_id').eq('cloudinary_public_id', staged.publicId).maybeSingle()
      if (retryLookupError) throw databaseError(retryLookupError)
      if (claimed?.product_id === productId) return { success: true, productId, secureUrl: staged.secureUrl }
      if (claimed) throw new MediaApiError(409, 'MEDIA_ALREADY_CLAIMED', 'Media is already attached.')
    }
    if (insertError) throw databaseError(insertError)
    await this.audit('product_media.claim', { productId, publicId: staged.publicId, secureUrl: staged.secureUrl }, actor)
    return { success: true, productId, secureUrl: staged.secureUrl }
  }

  async deleteStagedMedia({ uploadToken, actor }) {
    const staged = this.verifyStagedMedia(uploadToken, actor)
    const { data: existing, error } = await this.requireClient().from('product_media')
      .select('id').eq('cloudinary_public_id', staged.publicId)
    if (error) throw databaseError(error)
    if (existing?.length) throw new MediaApiError(409, 'MEDIA_ALREADY_CLAIMED', 'Media is already attached.')
    await this.cloudinaryService.deleteImage(staged.publicId)
    return { success: true, removedUrl: staged.secureUrl }
  }

  async deleteProductMedia({ productId, mediaId, secureUrl, actor }) {
    if (!productId || !UUID_REGEX.test(productId)) {
      throw new MediaApiError(400, 'INVALID_REQUEST', 'Product ID is missing or invalid.')
    }

    if (!mediaId && !secureUrl) {
      throw new MediaApiError(400, 'INVALID_REQUEST', 'mediaId or secureUrl is required.')
    }

    const client = this.requireClient()

    // 1. Verify product exists
    const { data: product, error: productError } = await client
      .from('products')
      .select('id, main_image_url, gallery_urls, card_image_url, card_hover_image_url')
      .eq('id', productId)
      .maybeSingle()

    if (productError) throw databaseError(productError)
    if (!product) throw new MediaApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.')

    // 2. Find target media record
    let query = client.from('product_media').select('*').eq('product_id', productId)
    if (mediaId) {
      query = query.eq('id', mediaId)
    } else if (secureUrl) {
      query = query.eq('secure_url', secureUrl)
    }

    const { data: mediaRows, error: mediaError } = await query
    if (mediaError) throw databaseError(mediaError)

    const targetRow = mediaRows?.[0]
    const targetUrl = secureUrl || targetRow?.secure_url
    const targetPublicId = targetRow?.cloudinary_public_id

    if (product.main_image_url === targetUrl) {
      throw new MediaApiError(409, 'MAIN_IMAGE_REQUIRED', 'Replace the main image before deleting it.')
    }

    // 3. Delete from product_media if row exists
    if (targetRow) {
      const { error: delError } = await client
        .from('product_media')
        .delete()
        .eq('id', targetRow.id)
      if (delError) throw databaseError(delError)
    }

    // 4. Synchronize products table
    const updates = {}
    if (targetUrl) {
      if (product.card_image_url === targetUrl) updates.card_image_url = ''
      if (product.card_hover_image_url === targetUrl) updates.card_hover_image_url = ''
      if (Array.isArray(product.gallery_urls) && product.gallery_urls.includes(targetUrl)) {
        updates.gallery_urls = product.gallery_urls.filter((url) => url !== targetUrl)
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      const { error: prodUpdateError } = await client
        .from('products')
        .update(updates)
        .eq('id', productId)
      if (prodUpdateError) throw databaseError(prodUpdateError)
    }

    // 5. Cloudinary deletion with reference and namespace safety check
    if (targetPublicId) {
      try {
        const { data: otherRefs } = await client
          .from('product_media')
          .select('id')
          .eq('cloudinary_public_id', targetPublicId)

        if (!otherRefs || otherRefs.length === 0) {
          await this.cloudinaryService.deleteImage(targetPublicId)
        }
      } catch (err) {
        this.logger.warn?.({
          event: 'media.delete_cloudinary_failed',
          targetPublicId,
          message: err.message,
        })
      }
    }

    // 6. Audit log
    await this.audit('product_media.delete', {
      productId,
      mediaId: targetRow?.id || mediaId || null,
      publicId: targetPublicId || null,
      secureUrl: targetUrl || null,
    }, actor)

    return {
      success: true,
      productId,
      removedUrl: targetUrl,
    }
  }

  async audit(action, metadata, actor) {
    if (!actor?.userId) return
    try {
      await this.requireClient().from('admin_audit_logs').insert({
        admin_id: actor.userId,
        action,
        resource: 'product_media',
        resource_id: metadata.productId,
        permission_key: 'media.commerce.manage',
        request_id: actor.requestId || '',
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      })
    } catch {
      this.logger.warn?.({
        event: 'media.audit_failed',
        action,
        productId: metadata.productId,
        requestId: actor.requestId,
      })
    }
  }
}

function databaseError(error) {
  if (error instanceof MediaApiError) return error
  return new MediaApiError(500, 'MEDIA_SERVICE_ERROR', 'The media operation could not be completed.')
}

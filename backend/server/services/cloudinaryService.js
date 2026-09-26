import { v2 as cloudinary } from 'cloudinary'

export class CloudinaryServiceError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class CloudinaryService {
  constructor({
    cloudName = process.env.CLOUDINARY_CLOUD_NAME,
    apiKey = process.env.CLOUDINARY_API_KEY,
    apiSecret = process.env.CLOUDINARY_API_SECRET,
    client = null,
    logger = console,
  } = {}) {
    this.cloudName = cloudName || ''
    this.apiKey = apiKey || ''
    this.apiSecret = apiSecret || ''
    this.client = client
    this.logger = logger

    if (this.client) {
      this.configured = true
    } else if (this.cloudName && this.apiKey && this.apiSecret) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      })
      this.configured = true
    } else {
      this.configured = false
    }
  }

  isConfigured() {
    return this.configured
  }

  async uploadImageBuffer(buffer, { productId, mediaType }) {
    if (!this.isConfigured()) {
      throw new CloudinaryServiceError(
        503,
        'CLOUDINARY_NOT_CONFIGURED',
        'Cloudinary media storage is not configured on this server.'
      )
    }

    const folder = `royal-fusion/products/${productId}`
    const suffix = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const publicId = `${folder}/${mediaType}-${suffix}`

    if (this.client) {
      return this.client.upload({ buffer, folder, publicId, mediaType, productId })
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: `${mediaType}-${suffix}`,
          resource_type: 'image',
          overwrite: true,
        },
        (error, result) => {
          if (error) {
            this.logger.error?.({
              event: 'cloudinary.upload_failed',
              folder,
              message: error.message,
            })
            return reject(
              new CloudinaryServiceError(
                500,
                'CLOUDINARY_UPLOAD_FAILED',
                'Failed to upload image to media provider.'
              )
            )
          }

          resolve({
            url: result.secure_url || result.url,
            secureUrl: result.secure_url || result.url,
            publicId: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
          })
        }
      )
      uploadStream.end(buffer)
    })
  }

  async deleteImage(publicId) {
    if (!this.isConfigured()) return { result: 'not_configured' }
    if (!publicId || typeof publicId !== 'string') return { result: 'invalid_public_id' }

    // Enforce Royal Fusion products folder namespace boundary
    if (!publicId.startsWith('royal-fusion/products/')) {
      this.logger.warn?.({
        event: 'cloudinary.delete_rejected_namespace',
        publicId,
      })
      return { result: 'rejected_namespace' }
    }

    if (this.client) {
      return this.client.destroy({ publicId })
    }

    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
      })
      return result
    } catch (error) {
      this.logger.warn?.({
        event: 'cloudinary.destroy_failed',
        publicId,
        message: error.message,
      })
      return { result: 'error' }
    }
  }
}

import { Router } from 'express'
import multer from 'multer'
import { AUTH_ERROR_CODES } from '../auth/contracts.js'
import {
  createAdminIdentity,
  createOriginGuard,
  requireAuthenticatedCsrf,
  sendCode,
} from '../middleware/authSecurity.js'
import {
  ProductMediaAdminService,
  MediaApiError,
} from '../services/productMediaAdminService.js'
import { CloudinaryService } from '../services/cloudinaryService.js'

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1,
  },
})

export function createAdminMediaV1Router(
  runtime,
  {
    client = runtime.repository?.client,
    logger = console,
    cloudinaryService = new CloudinaryService({ logger }),
  } = {}
) {
  const router = Router({ mergeParams: true })
  const service = new ProductMediaAdminService(client, cloudinaryService, logger, runtime.config.csrfSecret)
  const originGuard = createOriginGuard(runtime.config)
  const csrf = requireAuthenticatedCsrf(runtime.config)

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.use(createAdminIdentity(runtime))

  function permit(allowedPermissions) {
    return (req, res, next) => {
      const keys = req.administrator?.permissions || []
      const authorized =
        keys.includes('*') ||
        allowedPermissions.some((perm) => keys.includes(perm))

      if (!authorized) {
        return sendCode(res, AUTH_ERROR_CODES.PERMISSION_DENIED, req.requestId)
      }
      next()
    }
  }

  function handleFileUpload(req, res, next) {
    multerUpload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: {
                code: 'FILE_TOO_LARGE',
                message: 'Image exceeds maximum allowed size of 5MB.',
                requestId: req.requestId,
              },
            })
          }
          return res.status(400).json({
            error: {
              code: 'INVALID_FILE_UPLOAD',
              message: err.message,
              requestId: req.requestId,
            },
          })
        }
        return next(err)
      }
      next()
    })
  }

  // Upload endpoint: POST /api/v1/admin/media
  router.post(
    '/',
    permit(['products.manage', 'media.commerce.manage']),
    originGuard,
    csrf,
    handleFileUpload,
    route(async (req, res) => {
      if (!req.file) {
        throw new MediaApiError(400, 'MISSING_FILE', 'No image file was provided.')
      }

      const productId = req.body?.productId || req.params?.productId
      const mediaType = req.body?.mediaType
      const altText = req.body?.altText || ''
      const displayOrder = req.body?.displayOrder
        ? Number(req.body.displayOrder)
        : undefined

      const result = await service.uploadProductMedia({
        productId,
        mediaType,
        file: req.file,
        altText,
        displayOrder,
        actor: {
          userId: req.administrator.userId,
          requestId: req.requestId,
        },
      })

      res.status(201).json({
        data: result,
        meta: { requestId: req.requestId },
      })
    })
  )

  router.post(
    '/staged/claim',
    permit(['products.manage', 'media.commerce.manage']),
    originGuard,
    csrf,
    route(async (req, res) => {
      const result = await service.claimStagedMedia({
        productId: req.body?.productId,
        uploadToken: req.body?.uploadToken,
        actor: { userId: req.administrator.userId, requestId: req.requestId },
      })
      res.json({ data: result, meta: { requestId: req.requestId } })
    })
  )

  router.delete(
    '/staged',
    permit(['products.manage', 'media.delete', 'media.commerce.manage']),
    originGuard,
    csrf,
    route(async (req, res) => {
      const result = await service.deleteStagedMedia({
        uploadToken: req.body?.uploadToken,
        actor: { userId: req.administrator.userId, requestId: req.requestId },
      })
      res.json({ data: result, meta: { requestId: req.requestId } })
    })
  )

  // Delete endpoint: DELETE /api/v1/admin/media or /api/v1/admin/media/:mediaId
  router.delete(
    '/',
    permit(['products.manage', 'media.delete', 'media.commerce.manage']),
    originGuard,
    csrf,
    route(async (req, res) => {
      const productId = req.body?.productId || req.query?.productId || req.params?.productId
      const mediaId = req.body?.mediaId || req.query?.mediaId
      const secureUrl = req.body?.secureUrl || req.query?.secureUrl

      const result = await service.deleteProductMedia({
        productId,
        mediaId,
        secureUrl,
        actor: {
          userId: req.administrator.userId,
          requestId: req.requestId,
        },
      })

      res.json({
        data: result,
        meta: { requestId: req.requestId },
      })
    })
  )

  router.delete(
    '/:mediaId',
    permit(['products.manage', 'media.delete', 'media.commerce.manage']),
    originGuard,
    csrf,
    route(async (req, res) => {
      const productId = req.body?.productId || req.query?.productId || req.params?.productId
      const mediaId = req.params.mediaId
      const secureUrl = req.body?.secureUrl || req.query?.secureUrl

      const result = await service.deleteProductMedia({
        productId,
        mediaId,
        secureUrl,
        actor: {
          userId: req.administrator.userId,
          requestId: req.requestId,
        },
      })

      res.json({
        data: result,
        meta: { requestId: req.requestId },
      })
    })
  )

  // Centralized media error handler
  router.use((error, req, res, next) => {
    if (!(error instanceof MediaApiError)) return next(error)
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: req.requestId,
      },
    })
  })

  return router
}

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res)).catch(next)
}

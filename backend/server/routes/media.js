import { Router } from 'express'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import { requireAdmin } from '../middleware/auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uploadDir = path.resolve(__dirname, '../uploads')
const allowedImageTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${nanoid(8)}${extension}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024,
    files: 8
  },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const expectedMimeType = allowedImageTypes.get(extension)
    if (!expectedMimeType || expectedMimeType !== file.mimetype) {
      return cb(new Error('Only safe image uploads are allowed.'))
    }
    cb(null, true)
  }
})

export const mediaRouter = Router()

mediaRouter.use(requireAdmin)

mediaRouter.post('/', upload.array('images', 8), (req, res) => {
  const files = (req.files ?? []).map((file) => ({
    id: path.parse(file.filename).name,
    originalName: file.originalname,
    filename: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    url: `/uploads/${file.filename}`,
    altText: req.body.altText ?? ''
  }))

  res.status(201).json({ files })
})

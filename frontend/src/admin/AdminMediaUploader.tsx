import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'

interface AdminMediaUploaderProps {
  value: string[]
  onChange: (value: string[]) => void
  onMainImageSelect?: (value: string) => void
  allowUpload?: boolean
  onUpload?: (file: File) => Promise<string>
  onDelete?: (image: string) => Promise<void>
  multiple?: boolean
}

export function AdminMediaUploader({
  value,
  onChange,
  onMainImageSelect,
  allowUpload = true,
  onUpload,
  onDelete,
  multiple = true,
}: AdminMediaUploaderProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    setIsUploading(true)
    try {
      if (onUpload) {
        const added: string[] = []
        for (const file of Array.from(files)) {
          const uploadedUrl = await onUpload(file)
          if (uploadedUrl) added.push(uploadedUrl)
        }
        if (added.length) {
          onChange(multiple ? [...value, ...added] : [added[added.length - 1]])
        }
      } else {
        // Fallback for prototype non-product resources if any
        const response = await adminApi.uploadImages(Array.from(files))
        const urls = response.files.map((file) => file.url)
        onChange(multiple ? [...value, ...urls] : [urls[urls.length - 1]])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  const remove = async (image: string) => {
    setError('')
    try {
      if (onDelete) {
        await onDelete(image)
      }
      onChange(value.filter((item) => item !== image))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete media.')
    }
  }

  const move = (image: string, direction: -1 | 1) => {
    const index = value.indexOf(image)
    const nextIndex = index + direction
    if (index === -1 || nextIndex < 0 || nextIndex >= value.length) return
    const next = [...value]
    next[index] = value[nextIndex]
    next[nextIndex] = image
    onChange(next)
  }

  return (
    <div className="rounded-lg border border-champagne/30 bg-marble p-4">
      {allowUpload ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-champagne/50 bg-ivory px-4 py-5 text-sm font-bold text-burgundy transition hover:bg-champagne/10">
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
            )}
            {isUploading ? 'Uploading to Cloudinary...' : multiple ? 'Choose Image(s) to Upload' : 'Choose Image to Upload'}
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={isUploading}
              multiple={multiple}
              onChange={(event) => void upload(event.target.files)}
              type="file"
            />
          </label>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Image URL or path"
              className="h-10 min-w-0 flex-1 rounded-lg border border-champagne/35 bg-ivory px-3 text-xs outline-none focus:border-burgundy"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Or enter image URL (https://... or /assets/...)"
              type="text"
              value={url}
            />
            <Button
              onClick={() => {
                const next = url.trim()
                if (!next) return
                onChange(multiple ? [...value, next] : [next])
                setUrl('')
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Add URL
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Image URL or path"
            className="h-11 min-w-0 flex-1 rounded-lg border border-champagne/35 bg-ivory px-3 text-sm outline-none focus:border-burgundy"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="HTTPS image URL or /path/to/image.webp"
            type="text"
            value={url}
          />
          <Button
            onClick={() => {
              const next = url.trim()
              if (!next) return
              onChange([...value, next])
              setUrl('')
            }}
            type="button"
            variant="outline"
          >
            Add URL
          </Button>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-burgundy">{error}</p>}

      {value.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {value.map((image, index) => (
            <div className="rounded-lg border border-champagne/25 bg-ivory p-3" key={`${image}-${index}`}>
              {image.startsWith('/') || image.startsWith('http') || image.startsWith('blob:') ? (
                <img className="h-32 w-full rounded-md object-contain bg-cream/40" src={image} alt="Media preview" />
              ) : (
                <div className="grid h-32 place-items-center rounded-md bg-cream text-sm font-bold text-burgundy">
                  {image}
                </div>
              )}
              <p className="mt-2 truncate text-xs text-brownroyal/60" title={image}>{image}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {onMainImageSelect && (
                  <Button size="sm" variant="outline" onClick={() => onMainImageSelect(image)}>
                    Set Main
                  </Button>
                )}
                {multiple && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => move(image, -1)}>
                      Up
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => move(image, 1)}>
                      Down
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" onClick={() => void remove(image)}>
                  <Trash2 className="h-4 w-4 text-burgundy" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

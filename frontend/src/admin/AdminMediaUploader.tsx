import { ImagePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/common/Button'
import { adminApi } from '../services/adminApi'

interface AdminMediaUploaderProps {
  value: string[]
  onChange: (value: string[]) => void
  onMainImageSelect?: (value: string) => void
}

export function AdminMediaUploader({
  value,
  onChange,
  onMainImageSelect,
}: AdminMediaUploaderProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setError('')
    setIsUploading(true)
    try {
      const response = await adminApi.uploadImages(Array.from(files))
      onChange([...value, ...response.files.map((file) => file.url)])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  const remove = (image: string) => {
    onChange(value.filter((item) => item !== image))
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
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-champagne/50 bg-ivory px-4 py-5 text-sm font-bold text-burgundy transition hover:bg-champagne/10">
        <ImagePlus className="h-5 w-5" aria-hidden="true" />
        {isUploading ? 'Uploading...' : 'Upload images'}
        <input
          accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
          className="sr-only"
          multiple
          onChange={(event) => void upload(event.target.files)}
          type="file"
        />
      </label>
      {error && <p className="mt-3 text-sm font-semibold text-burgundy">{error}</p>}
      {value.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {value.map((image, index) => (
            <div className="rounded-lg border border-champagne/25 bg-ivory p-3" key={`${image}-${index}`}>
              {image.startsWith('/') || image.startsWith('http') ? (
                <img className="h-32 w-full rounded-md object-cover" src={image} alt="Uploaded preview" />
              ) : (
                <div className="grid h-32 place-items-center rounded-md bg-cream text-sm font-bold text-burgundy">
                  {image}
                </div>
              )}
              <p className="mt-2 truncate text-xs text-brownroyal/60">{image}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {onMainImageSelect && (
                  <Button size="sm" variant="outline" onClick={() => onMainImageSelect(image)}>
                    Main
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => move(image, -1)}>
                  Up
                </Button>
                <Button size="sm" variant="ghost" onClick={() => move(image, 1)}>
                  Down
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(image)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

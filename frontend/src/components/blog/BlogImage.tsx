import type { BlogImage as EditorialImage } from '../../../../shared/contracts/blogV1'
import { usePublicBlogIntegration } from '../../blog/PublicBlogProvider'
import { blogImageUrl } from '../../services/blogImages'

export function BlogImage({ image, width = 1200, height, caption = false, className = '', loading = 'lazy' }: {
  image: EditorialImage; width?: number; height?: number; caption?: boolean; className?: string; loading?: 'lazy' | 'eager'
}) {
  const { client } = usePublicBlogIntegration()
  if (!client) throw new TypeError('Blog configuration is invalid.')
  const cropWidth = image.asset.width * (1 - (image.crop?.left ?? 0) - (image.crop?.right ?? 0))
  const cropHeight = image.asset.height * (1 - (image.crop?.top ?? 0) - (image.crop?.bottom ?? 0))
  return <figure>
    <img alt={image.alt} className={`h-auto w-full rounded-lg ${className}`} decoding="async" loading={loading}
      width={width} height={height ?? Math.round(width * cropHeight / cropWidth)}
      src={blogImageUrl(image, client.configuration, width, height)} />
    {caption && image.caption && <figcaption className="mt-2 text-sm text-brownroyal/65">{image.caption}</figcaption>}
  </figure>
}

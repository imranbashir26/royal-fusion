import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { cn } from '../../utils/cn'

export interface AnnouncementItem {
  id?: string
  enabled?: boolean
  message: string
  ctaLabel?: string
  ctaUrl?: string
  displayOrder?: number
}

interface AnnouncementBarProps {
  announcements?: AnnouncementItem[]
  className?: string
}

export function AnnouncementBar({ announcements: customAnnouncements, className }: AnnouncementBarProps) {
  const { settings, banners } = useStorefront()
  const prefersReducedMotion = useReducedMotion()
  const [currentIndex, setCurrentIndex] = useState(0)

  // Resolve announcements from props or storefront settings and marketing banners
  const items = useMemo<AnnouncementItem[]>(() => {
    if (customAnnouncements) {
      return customAnnouncements.filter((item) => item.enabled !== false && item.message.trim().length > 0)
    }

    const resolved: AnnouncementItem[] = []

    // 1. Settings announcement
    if (settings.announcementEnabled && settings.announcementText?.trim()) {
      resolved.push({
        id: 'settings-announcement',
        enabled: true,
        message: settings.announcementText.trim(),
        ctaLabel: settings.announcementCtaLabel?.trim() || undefined,
        ctaUrl: settings.announcementCtaUrl?.trim() || undefined,
        displayOrder: 0,
      })
    }

    // 2. Banner-driven top announcements
    const topBanners = (banners || []).filter(
      (b) => b.enabled && b.position === 'Top announcement bar',
    )
    for (const banner of topBanners) {
      const message = banner.title?.trim() || banner.subtitle?.trim()
      if (message) {
        resolved.push({
          id: banner.id,
          enabled: true,
          message,
          ctaLabel: banner.ctaText?.trim() || undefined,
          ctaUrl: banner.ctaLink?.trim() || undefined,
          displayOrder: 1,
        })
      }
    }

    return resolved.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  }, [customAnnouncements, settings, banners])

  // Restrained cycle if multiple announcements exist
  useEffect(() => {
    if (items.length <= 1) return

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length)
    }, 6000)

    return () => clearInterval(interval)
  }, [items.length])

  // If no active announcements, render nothing cleanly
  if (items.length === 0) {
    return null
  }

  const activeIndex = currentIndex % items.length
  const currentItem = items[activeIndex]

  const isExternalCta = currentItem.ctaUrl?.startsWith('http://') || currentItem.ctaUrl?.startsWith('https://')

  return (
    <aside
      aria-label="Announcement"
      className={cn(
        'w-full border-b border-champagne/15 bg-deep-wine text-warm-ivory transition-colors',
        className,
      )}
      role="region"
    >
      <div className="container-lux flex min-h-[36px] items-center justify-center px-4 py-1.5 sm:min-h-[38px]">
        {items.length === 1 ? (
          <div className="flex max-w-full items-center justify-center gap-1.5 text-center text-[12px] font-medium tracking-wide sm:gap-2 sm:text-[13px]">
            <span className="truncate">{currentItem.message}</span>
            {currentItem.ctaLabel && currentItem.ctaUrl && (
              <AnnouncementCta
                isExternal={isExternalCta}
                label={currentItem.ctaLabel}
                url={currentItem.ctaUrl}
              />
            )}
          </div>
        ) : (
          <div className="relative flex h-5 w-full items-center justify-center overflow-hidden">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex max-w-full items-center justify-center gap-1.5 text-center text-[12px] font-medium tracking-wide sm:gap-2 sm:text-[13px]"
                exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -6 }}
                initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 6 }}
                key={currentItem.id || activeIndex}
                transition={{ duration: prefersReducedMotion ? 0.1 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="truncate">{currentItem.message}</span>
                {currentItem.ctaLabel && currentItem.ctaUrl && (
                  <AnnouncementCta
                    isExternal={isExternalCta}
                    label={currentItem.ctaLabel}
                    url={currentItem.ctaUrl}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </aside>
  )
}

function AnnouncementCta({
  label,
  url,
  isExternal,
}: {
  label: string
  url: string
  isExternal?: boolean
}) {
  const ctaClasses =
    'inline-flex shrink-0 items-center gap-1 font-semibold text-champagne transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-champagne rounded-xs'

  if (isExternal) {
    return (
      <a className={ctaClasses} href={url} rel="noreferrer" target="_blank">
        <span>{label}</span>
        <ArrowRight aria-hidden="true" className="h-3 w-3" />
      </a>
    )
  }

  return (
    <Link className={ctaClasses} to={url}>
      <span>{label}</span>
      <ArrowRight aria-hidden="true" className="h-3 w-3" />
    </Link>
  )
}

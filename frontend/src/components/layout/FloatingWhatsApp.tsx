import { MessageCircle } from 'lucide-react'
import { useStorefront } from '../../storefront/StorefrontProvider'
import { whatsappUrl } from '../../utils/contactDetails'

export function FloatingWhatsApp() {
  const { settings } = useStorefront()
  const href = whatsappUrl(settings.whatsappNumber)
  if (!href) return null

  return (
    <a
      aria-label="Chat on WhatsApp"
      className="fixed bottom-24 right-3 z-30 grid h-12 w-12 place-items-center rounded-full bg-[#2f8f5b] text-white shadow-2xl shadow-brownroyal/20 transition hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-burgundy md:bottom-6 md:right-4 md:h-14 md:w-14"
      href={`${href}?text=Assalamualaikum%20Royal%20Fusion,%20I%20want%20to%20explore%20your%20perfumes.`}
      rel="noreferrer"
      target="_blank"
    >
      <MessageCircle className="h-6 w-6 md:h-7 md:w-7" aria-hidden="true" />
    </a>
  )
}

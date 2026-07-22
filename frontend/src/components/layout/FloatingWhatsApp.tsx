import { MessageCircle } from 'lucide-react'

export function FloatingWhatsApp() {
  return (
    <a
      aria-label="Chat on WhatsApp"
      className="fixed bottom-24 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-[#2f8f5b] text-white shadow-2xl shadow-brownroyal/20 transition hover:-translate-y-1 md:bottom-6"
      href="https://wa.me/923000000000?text=Assalamualaikum%20Royal%20Fusion,%20I%20want%20to%20explore%20your%20perfumes."
      rel="noreferrer"
      target="_blank"
    >
      <MessageCircle className="h-7 w-7" aria-hidden="true" />
    </a>
  )
}

export function publicPhone(value?: string) {
  const phone = value?.trim() ?? ''
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15 && !/(\d)\1{6,}$/.test(digits)
    ? phone
    : ''
}

export function whatsappUrl(value?: string) {
  const phone = publicPhone(value)
  return phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : ''
}

export function publicEmail(value?: string) {
  const email = value?.trim() ?? ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.toLowerCase() !== 'hello@royalfusion.pk'
    ? email
    : ''
}

export function publicAddress(value?: string) {
  const address = value?.trim() ?? ''
  return address && address.toLowerCase() !== 'karachi, pakistan' ? address : ''
}

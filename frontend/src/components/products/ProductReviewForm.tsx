import { useState, type FormEvent } from 'react'
import { Button } from '../common/Button'
import { submitProductReview } from '../../services/publicReviewsService'

export function ProductReviewForm({ productId }: { productId: string }) {
  const [name, setName] = useState('')
  const [city, setCity] = useState('')
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!rating) { setError('Choose a rating from 1 to 5.'); return }
    setBusy(true)
    try {
      const message = await submitProductReview({ productId, name: name.trim(), city: city.trim(), rating, text: text.trim() })
      setSuccess(message)
      setName('')
      setCity('')
      setRating(0)
      setText('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your review could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="mt-10 max-w-2xl rounded-lg border border-champagne/25 bg-ivory p-6" onSubmit={(event) => void submit(event)}>
      <h3 className="font-serif text-2xl font-semibold text-burgundy">Write a Review</h3>
      <p className="mt-1 text-sm text-brownroyal/65">Your review will appear after moderation.</p>
      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-brownroyal">Rating</legend>
        <div className="mt-2 flex gap-3">
          {[1, 2, 3, 4, 5].map((value) => (
            <label className="flex items-center gap-1 text-sm" key={value}>
              <input checked={rating === value} name="rating" onChange={() => setRating(value)} required type="radio" value={value} />{value}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-brownroyal">Name
          <input className="min-h-11 rounded-lg border border-champagne/40 bg-white px-3" maxLength={80} minLength={2} onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-brownroyal">City (optional)
          <input className="min-h-11 rounded-lg border border-champagne/40 bg-white px-3" maxLength={80} onChange={(event) => setCity(event.target.value)} value={city} />
        </label>
      </div>
      <label className="mt-4 grid gap-1 text-sm font-semibold text-brownroyal">Your review
        <textarea className="min-h-28 rounded-lg border border-champagne/40 bg-white p-3" maxLength={2000} minLength={10} onChange={(event) => setText(event.target.value)} required value={text} />
      </label>
      {error && <p className="mt-3 text-sm text-red-800" role="alert">{error}</p>}
      {success && <p className="mt-3 text-sm text-brownroyal" role="status">{success}</p>}
      <Button className="mt-5" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit Review'}</Button>
    </form>
  )
}

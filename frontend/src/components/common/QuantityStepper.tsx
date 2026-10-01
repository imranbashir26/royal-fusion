import { Minus, Plus } from 'lucide-react'
import { Button } from './Button'

interface QuantityStepperProps {
  value: number
  onChange: (value: number) => void
  max?: number
  disabled?: boolean
}

export function QuantityStepper({ value, onChange, max = 99, disabled = false }: QuantityStepperProps) {
  return (
    <div className="inline-grid h-11 grid-cols-[44px_48px_44px] overflow-hidden rounded-full border border-champagne/45 bg-ivory/80">
      <Button
        aria-label="Decrease quantity"
        className="h-11 rounded-none px-0"
        disabled={disabled || value <= 1}
        onClick={() => onChange(Math.min(max, Math.max(1, value - 1)))}
        variant="ghost"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </Button>
      <span className="grid place-items-center text-sm font-bold text-burgundy">{value}</span>
      <Button
        aria-label="Increase quantity"
        className="h-11 rounded-none px-0"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        variant="ghost"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

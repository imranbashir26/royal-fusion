import {useEffect, useState} from 'react'
import {adminAuthClient} from './adminAuthClient'

/** Shared fresh server read for the editor hook and bulk submission preflight. */
export async function readSaleSchedulingCapability(signal?: AbortSignal): Promise<boolean> {
  try {
    const result = await adminAuthClient.protectedRequest<{scheduledSaleWrites: boolean}>('/v1/admin/products/sale-capabilities', {signal})
    return result?.scheduledSaleWrites === true
  } catch {return false}
}

/** A failed/malformed read never enables controls. Writes remain server-enforced. */
export function useSaleSchedulingCapability(authorized = true) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    setEnabled(false)
    if (authorized) void readSaleSchedulingCapability()
      .then(result => { if (alive) setEnabled(result) })
    return () => { alive = false }
  }, [authorized])
  return authorized && enabled
}

import {useEffect, useState} from 'react'
import {adminAuthClient} from './adminAuthClient'

/** A failed/malformed read never enables controls. Writes remain server-enforced. */
export function useSaleSchedulingCapability(authorized = true) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    setEnabled(false)
    if (authorized) void adminAuthClient.protectedRequest<{scheduledSaleWrites: boolean}>('/v1/admin/products/sale-capabilities')
      .then(result => { if (alive) setEnabled(result?.scheduledSaleWrites === true) })
      .catch(() => { if (alive) setEnabled(false) })
    return () => { alive = false }
  }, [authorized])
  return authorized && enabled
}

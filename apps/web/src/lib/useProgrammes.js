import { useEffect, useState } from 'react'
import { programmes as fallback } from '@cca/shared/programmes'
import { api } from './api.js'

let cache = null

// Live programme catalogue from the API (admin-editable), falling back to the bundled list if offline.
export function useProgrammes() {
  const [list, setList] = useState(cache ?? fallback)
  const [loaded, setLoaded] = useState(Boolean(cache))
  useEffect(() => {
    if (cache) return
    let alive = true
    api('/programmes')
      .then((rows) => { if (alive && Array.isArray(rows) && rows.length) { cache = rows; setList(rows) } })
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => { alive = false }
  }, [])
  return { programmes: list, loaded }
}

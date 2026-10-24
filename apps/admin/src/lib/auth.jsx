import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from './api.js'

const AuthContext = createContext(null)

// Staff session. The API rejects non-staff accounts on the admin portal.
export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: Boolean(getToken()), user: null })

  const refresh = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null })
    try {
      const me = await api('/auth/me')
      if (!['super_admin', 'staff'].includes(me.user.role)) throw new Error('not staff')
      setState({ loading: false, user: me.user })
    } catch {
      setToken(null)
      setState({ loading: false, user: null })
    }
  }, [])

  useEffect(() => {
    refresh()
    const onOut = () => setState({ loading: false, user: null })
    window.addEventListener('cca-admin:signed-out', onOut)
    return () => window.removeEventListener('cca-admin:signed-out', onOut)
  }, [refresh])

  const value = useMemo(() => {
    async function finish(res) {
      if (res.otpRequired) return res
      setToken(res.token)
      await refresh()
      return res
    }
    return {
      ...state,
      isSuper: state.user?.role === 'super_admin',
      login: (identifier, password) => api('/auth/login', { method: 'POST', body: { identifier, password, portal: 'admin' } }).then(finish),
      verifyOtp: (challenge, code) => api('/auth/otp', { method: 'POST', body: { challenge, code } }).then(finish),
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {})
        setToken(null)
        setState({ loading: false, user: null })
      },
      refresh,
    }
  }, [state, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

// Programmes, cohorts and courses for dropdowns, loaded once per session.
const LookupsContext = createContext(null)

export function LookupsProvider({ children }) {
  const [lookups, setLookups] = useState({ programmes: [], cohorts: [], courses: [], integrations: {} })
  const reload = useCallback(() => api('/admin/lookups').then(setLookups).catch(() => {}), [])
  useEffect(() => { reload() }, [reload])
  const value = useMemo(() => ({ ...lookups, reloadLookups: reload }), [lookups, reload])
  return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>
}

export const useLookups = () => useContext(LookupsContext)

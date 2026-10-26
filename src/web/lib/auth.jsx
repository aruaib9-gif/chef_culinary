'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from './api.js'

const AuthContext = createContext(null)

// Session state for the student portal and applicants. The token is a bearer token issued by /api/auth.
export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, student: null })

  const refresh = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null, student: null })
    try {
      const me = await api('/auth/me')
      setState({ loading: false, user: me.user, student: me.student })
    } catch {
      setState({ loading: false, user: null, student: null })
    }
  }, [])

  useEffect(() => {
    refresh()
    const onSignedOut = () => setState({ loading: false, user: null, student: null })
    window.addEventListener('cca:signed-out', onSignedOut)
    return () => window.removeEventListener('cca:signed-out', onSignedOut)
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
      login: (identifier, password) => api('/auth/login', { method: 'POST', body: { identifier, password, portal: 'student' } }).then(finish),
      verifyOtp: (challenge, code) => api('/auth/otp', { method: 'POST', body: { challenge, code } }).then(finish),
      signup: (data) => api('/auth/signup', { method: 'POST', body: data }).then(finish),
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {})
        setToken(null)
        setState({ loading: false, user: null, student: null })
      },
      refresh,
    }
  }, [state, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

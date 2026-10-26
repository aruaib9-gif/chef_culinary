'use client'
// React Router-compatible helpers on top of Next.js navigation, so the existing screens keep their
// `Link`, `NavLink`, `useNavigate`, `useParams`, `useSearchParams` and `Navigate` code unchanged.
// Inside /admin, absolute links are resolved against /admin (like React Router's basename).
import { useEffect, useMemo } from 'react'
import NextLink from 'next/link'
import { usePathname, useRouter, useParams as useNextParams, useSearchParams as useNextSearchParams } from 'next/navigation'

const ADMIN = '/admin'

function useBase() {
  const pathname = usePathname() ?? '/'
  return pathname === ADMIN || pathname.startsWith(`${ADMIN}/`) ? ADMIN : ''
}

function resolve(to, base) {
  if (typeof to !== 'string') to = `${to.pathname ?? ''}${to.search ?? ''}`
  if (!base || !to.startsWith('/') || to === base || to.startsWith(`${base}/`) || to.startsWith('/api/')) return to
  return to === '/' ? base : `${base}${to}`
}

// Navigation state (React Router's location.state), kept in memory for the next page.
let pendingState = null
const setPendingState = (href, state) => {
  pendingState = state == null ? null : { path: href.split('?')[0], state }
}

export function useNavigate() {
  const router = useRouter()
  const base = useBase()
  return (to, { replace = false, state } = {}) => {
    if (typeof to === 'number') return to < 0 ? router.back() : router.forward()
    const href = resolve(to, base)
    setPendingState(href, state)
    replace ? router.replace(href) : router.push(href)
  }
}

export function useLocation() {
  const pathname = usePathname() ?? '/'
  const search = typeof window === 'undefined' ? '' : window.location.search
  return { pathname, search, hash: '', state: pendingState?.path === pathname ? pendingState.state : null }
}

export function useParams() {
  return useNextParams() ?? {}
}

/** [params, setParams] like React Router; setParams(object | URLSearchParams, { replace }). */
export function useSearchParams() {
  const params = useNextSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const current = useMemo(() => new URLSearchParams(params?.toString() ?? ''), [params])
  const set = (next, { replace = false } = {}) => {
    const value = typeof next === 'function' ? next(new URLSearchParams(current)) : next
    const qs = new URLSearchParams(value).toString()
    const href = qs ? `${pathname}?${qs}` : pathname
    replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false })
  }
  return [current, set]
}

export function Link({ to, state, replace, children, onClick, ...rest }) {
  const href = resolve(to, useBase())
  return (
    <NextLink
      href={href}
      replace={replace}
      onClick={(e) => {
        setPendingState(href, state)
        onClick?.(e)
      }}
      {...rest}
    >
      {children}
    </NextLink>
  )
}

export function NavLink({ to, end, className, children, ...rest }) {
  const pathname = usePathname() ?? '/'
  const href = resolve(to, useBase())
  const active = end ? pathname === href : pathname === href || pathname.startsWith(`${href === '/' ? '' : href}/`)
  const cls = typeof className === 'function' ? className({ isActive: active }) : [className, active && 'active'].filter(Boolean).join(' ')
  return (
    <Link to={href} className={cls || undefined} aria-current={active ? 'page' : undefined} {...rest}>
      {typeof children === 'function' ? children({ isActive: active }) : children}
    </Link>
  )
}

export function Navigate({ to, replace = false, state }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(to, { replace, state })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** A `?next=` value that's safe to redirect to: same-site paths only (never another domain). */
export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null
}

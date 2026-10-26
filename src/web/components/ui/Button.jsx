'use client'
import { Link } from '@/lib/router'
import './Button.css'

export default function Button({ to, href, variant = 'primary', block, className = '', children, ...rest }) {
  const classes = ['btn', `btn--${variant}`, block && 'btn--block', className].filter(Boolean).join(' ')
  if (to) return <Link to={to} className={classes} {...rest}>{children}</Link>
  if (href) return <a href={href} className={classes} {...rest}>{children}</a>
  return <button className={classes} {...rest}>{children}</button>
}

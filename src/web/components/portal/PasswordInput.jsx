'use client'
import { useState } from 'react'

export default function PasswordInput(props) {
  const [show, setShow] = useState(false)
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {show
            ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0112 5c6 0 9.5 7 9.5 7a17 17 0 01-3.2 4.1M6.6 6.6A17 17 0 002.5 12S6 19 12 19a9.9 9.9 0 005.4-1.6" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>
            : <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
    </span>
  )
}

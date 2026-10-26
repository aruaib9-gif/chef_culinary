'use client'
import './PageHeader.css'

export default function PageHeader({ eyebrow, title, intro }) {
  return (
    <header className="page-header">
      <div className="container">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
    </header>
  )
}

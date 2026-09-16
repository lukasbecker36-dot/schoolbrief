'use client'

import { useEffect, useRef, useState } from 'react'

export type SignedInUser = { email: string; inbound_address: string }

// Shows who is signed in, and opens a small menu when clicked. Used top right on
// the front page (with a link to the account) and in the manage page header
// (where that link would just point at the page you're on, so it's hidden).
// Renders nothing when signed out.
export default function AccountMenu({
  user,
  showAccountHome = true,
  className = ''
}: {
  user: SignedInUser | null
  showAccountHome?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on a click outside the menu, or on Escape.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!user) return null

  const itemClass = 'block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100'

  return (
    // The wrapper anchors the dropdown, which needs it positioned. Callers pass
    // their own positioning (absolute, top right); only fall back to relative
    // when they don't. Adding relative alongside a caller's absolute made the
    // two classes compete, and relative won -- so the box sat in the page flow.
    <div ref={containerRef} className={className || 'relative'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full bg-white border rounded-lg shadow-sm px-4 py-2 hover:border-blue-400 transition text-right"
      >
        <p className="text-xs font-medium text-green-700">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 align-middle" />
          Logged in
          <span className="text-gray-400 ml-1.5" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </p>
        <p className="text-sm text-gray-900 break-all">{user.email}</p>
        <p className="text-xs text-gray-500 font-mono break-all">{user.inbound_address}</p>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-full sm:w-56 bg-white border rounded-lg shadow-lg py-1 z-20"
        >
          {showAccountHome && (
            <a role="menuitem" href="/manage" className={itemClass}>
              Account home
            </a>
          )}
          <form method="POST" action="/api/auth/logout">
            <button type="submit" role="menuitem" className={itemClass}>
              Logout
            </button>
          </form>
          <a role="menuitem" href="/how-it-works" className={itemClass}>
            How it works
          </a>
        </div>
      )}
    </div>
  )
}

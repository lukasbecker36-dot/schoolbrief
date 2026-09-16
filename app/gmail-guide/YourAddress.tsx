'use client'

import { useEffect, useState } from 'react'

// Shows the parent's own SchoolBrief address beside the step that needs it.
// Addresses are random (e.g. xhdg56st@in.schoolbrief.uk), so without this the
// parent has to leave the guide to go and find theirs. Renders nothing when
// signed out, leaving the example in the step text.
export default function YourAddress() {
  const [address, setAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/manage/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => setAddress(data?.user?.inbound_address || null))
      .catch(() => {})
  }, [])

  if (!address) return null

  function copy() {
    navigator.clipboard.writeText(address!)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
      <p className="text-xs text-blue-900 mb-1">Your SchoolBrief address:</p>
      <button
        onClick={copy}
        className="w-full bg-white hover:bg-gray-50 border rounded-md p-2 font-mono text-sm text-gray-900 break-all text-left"
      >
        {address}
      </button>
      <p className="text-xs text-blue-700 mt-1">{copied ? '✅ Copied!' : 'Tap to copy'}</p>
    </div>
  )
}

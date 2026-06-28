'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const REASONS: Record<string, string> = {
  denied: 'It looks like access was declined. You can try again whenever you\'re ready.',
  badstate: 'That link expired or was invalid. Please start the connection again.',
  norefresh: 'Google didn\'t grant ongoing access. Please try again and tick all the permission boxes.',
  nouser: 'We couldn\'t match this to a SchoolBrief account. Sign up first, then connect Gmail.',
  storage: 'Something went wrong saving the connection. Please try again.'
}

function Connected() {
  const params = useSearchParams()
  const status = params.get('status')
  const reason = params.get('reason') || ''
  const [domains, setDomains] = useState('')
  const [saved, setSaved] = useState(false)
  const [email, setEmail] = useState('')

  const emailParam = params.get('email')
  useEffect(() => {
    if (emailParam) {
      setEmail(emailParam)
      return
    }
    const stored = typeof window !== 'undefined' ? localStorage.getItem('sb_email') : null
    if (stored) setEmail(stored)
  }, [emailParam])

  if (status !== 'ok') {
    return (
      <div className="bg-white p-8 rounded-xl shadow max-w-md w-full text-center">
        <div className="text-4xl mb-4">😕</div>
        <h1 className="text-2xl font-bold mb-2 text-gray-900">Couldn't connect Gmail</h1>
        <p className="text-gray-600 mb-6">{REASONS[reason] || 'Something went wrong. Please try again.'}</p>
        <a href="/manage" className="inline-block bg-blue-600 text-white rounded-lg px-5 py-3 font-medium text-sm">
          Back to your account
        </a>
      </div>
    )
  }

  async function saveDomains() {
    await fetch('/api/gmail/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, domains })
    })
    setSaved(true)
  }

  return (
    <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
      <div className="text-4xl mb-4 text-center">✅</div>
      <h1 className="text-2xl font-bold mb-2 text-gray-900 text-center">Gmail connected!</h1>
      <p className="text-gray-600 mb-6 text-center">
        We'll now pick up your school emails automatically — no forwarding needed.
      </p>

      <div className="border-t pt-6">
        <label className="block text-sm font-medium text-gray-900 mb-2">
          Which addresses do your school emails come from?
        </label>
        <p className="text-xs text-gray-500 mb-3">
          So we only ever read school emails, not your personal mail. Enter domains or addresses, comma-separated
          (e.g. <code className="bg-gray-100 px-1 rounded">yourschool.sch.uk, parentmail.co.uk</code>).
        </p>
        <input
          type="text"
          value={domains}
          onChange={e => setDomains(e.target.value)}
          placeholder="yourschool.sch.uk, parentmail.co.uk"
          className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 placeholder-gray-500"
        />
        {!saved ? (
          <button
            onClick={saveDomains}
            disabled={!domains || !email}
            className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
          >
            Save
          </button>
        ) : (
          <p className="text-sm text-green-800 text-center bg-green-50 rounded-lg p-3">
            ✅ Saved! We'll start pulling in school emails from these senders.
          </p>
        )}
        {!email && (
          <p className="text-xs text-amber-700 mt-3">
            We couldn't detect your account email — please <a href="/manage" className="underline">set your school senders on the manage page</a> instead.
          </p>
        )}
      </div>
    </div>
  )
}

export default function GmailConnectedPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
        <Connected />
      </Suspense>
    </main>
  )
}

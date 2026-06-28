'use client'

import { useState, useEffect, useRef } from 'react'

type OnboardingStatus = {
  received: boolean
  eventCount: number
  noticeCount: number
  schoolName: string | null
  hasChildren: boolean
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [sendingDigest, setSendingDigest] = useState(false)
  const [digestSent, setDigestSent] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function handleSignup() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, inviteCode })
    })
    const data = await res.json()
    if (data.address) {
      setAddress(data.address)
      setSubmitted(true)
      if (typeof window !== 'undefined') localStorage.setItem('sb_email', email)
    } else {
      setError(data.error || 'Something went wrong')
    }
    setLoading(false)
  }

  // Poll for the first forwarded email once the user has signed up.
  useEffect(() => {
    if (!submitted) return

    async function check() {
      try {
        const res = await fetch('/api/onboarding/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })
        const data = await res.json()
        if (!data.error) {
          setStatus(data)
          if (data.received && pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        }
      } catch {
        // keep polling
      }
    }

    check()
    pollRef.current = setInterval(check, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [submitted, email])

  function copyAddress() {
    navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function sendDigestNow() {
    setSendingDigest(true)
    await fetch('/api/onboarding/send-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    setSendingDigest(false)
    setDigestSent(true)
  }

  if (submitted) {
    const received = status?.received
    const foundCount = (status?.eventCount || 0) + (status?.noticeCount || 0)

    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
          <div className="text-4xl mb-4 text-center">📬</div>
          <h1 className="text-2xl font-bold mb-2 text-gray-900 text-center">You're signed up!</h1>
          <p className="text-gray-600 mb-6 text-center">Let's see it work. Forward <strong>any one school email</strong> to your address:</p>

          <button
            onClick={copyAddress}
            className="w-full bg-gray-100 hover:bg-gray-200 rounded-lg p-4 font-mono text-sm break-all mb-2 text-gray-900 font-medium transition"
          >
            {address}
          </button>
          <p className="text-xs text-gray-400 text-center mb-6">{copied ? '✅ Copied!' : 'Tap to copy'}</p>

          {/* Live status of the first forwarded email */}
          {!received && (
            <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-4 mb-4">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-blue-900">Waiting for your first email…</span>
            </div>
          )}

          {received && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-900 font-medium mb-1">
                ✅ Got your email{status?.schoolName ? ` from ${status.schoolName}` : ''}!
              </p>
              <p className="text-sm text-green-800">
                {foundCount > 0
                  ? `We found ${status?.eventCount || 0} event${status?.eventCount === 1 ? '' : 's'}${status?.noticeCount ? ` and ${status.noticeCount} notice${status.noticeCount === 1 ? '' : 's'}` : ''}.`
                  : 'No dated events in that one — try forwarding a newsletter with upcoming dates to see more.'}
              </p>
            </div>
          )}

          {/* See your digest now */}
          {received && foundCount > 0 && (
            <div className="mb-6">
              {!digestSent ? (
                <button
                  onClick={sendDigestNow}
                  disabled={sendingDigest}
                  className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
                >
                  {sendingDigest ? 'Sending…' : '📧 See your digest now'}
                </button>
              ) : (
                <p className="text-sm text-green-800 text-center bg-green-50 rounded-lg p-3">
                  ✅ Sent! Check your inbox to see your digest.
                </p>
              )}
            </div>
          )}

          {/* Automate it */}
          <div className="border-t pt-6">
            <p className="text-sm text-gray-700 mb-3">
              {received
                ? 'Want this every morning automatically, without forwarding by hand?'
                : 'Then automate it so you never have to forward by hand:'}
            </p>
            <a
              href={`/api/gmail/connect?email=${encodeURIComponent(email)}`}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-3 font-medium text-sm w-full text-center mb-2"
            >
              Connect Gmail (recommended) →
            </a>
            <p className="text-xs text-gray-400 text-center">
              On a different provider? <a href="/how-it-works" className="underline">Set up forwarding instead</a>
            </p>
            <a href="/manage" className="inline-block text-blue-600 text-sm mt-4 hover:underline w-full text-center">
              {status?.hasChildren ? 'Manage your children →' : 'Add your children\'s details →'}
            </a>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
        <div className="text-4xl mb-4">🏫</div>
        <h1 className="text-3xl font-bold mb-2 text-gray-900">SchoolBrief</h1>
        <p className="text-gray-600 mb-2">Get a daily summary of your school emails — events, deadlines, and reminders in one clear morning email.</p>
        <a href="/how-it-works" className="text-blue-600 text-sm mb-6 inline-block hover:underline">How does it work? →</a>
        <input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 placeholder-gray-500"
        />
        <input
          type="text"
          placeholder="Invite code"
          value={inviteCode}
          onChange={e => setInviteCode(e.target.value)}
          className="w-full border rounded-lg p-3 mb-4 text-sm text-gray-900 placeholder-gray-500"
        />
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button
          onClick={handleSignup}
          disabled={loading || !email || !inviteCode}
          className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
        >
          {loading ? 'Setting up...' : 'Get my forwarding address'}
        </button>
        <p className="text-xs text-gray-400 mt-4 text-center">Currently in private beta — invite only.</p>
<p className="text-xs text-gray-400 mt-2 text-center">Already signed up? <a href="/manage" className="text-blue-500 hover:underline">Manage your children →</a></p>
      </div>
    </main>
  )
}
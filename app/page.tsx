'use client'

import { useState } from 'react'

export default function Home() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignup() {
    setLoading(true)
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const data = await res.json()
    if (data.address) {
      setAddress(data.address)
      setSubmitted(true)
    }
    setLoading(false)
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md w-full text-center">
          <div className="text-4xl mb-4">📬</div>
          <h1 className="text-2xl font-bold mb-2">You're signed up!</h1>
          <p className="text-gray-600 mb-6">Forward your school emails to this address:</p>
          <div className="bg-gray-100 rounded-lg p-4 font-mono text-sm break-all mb-6 text-gray-900 font-medium">
            {address}
          </div>
          <p className="text-gray-500 text-sm">You'll receive a daily digest every morning with upcoming school events.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
        <div className="text-4xl mb-4">🏫</div>
        <h1 className="text-3xl font-bold mb-2">SchoolBrief</h1>
        <p className="text-gray-600 mb-6">Get a daily summary of your school emails — events, deadlines, and reminders in one clear morning email.</p>
        <input
          type="email"
          placeholder="Your email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full border rounded-lg p-3 mb-4 text-sm text-gray-900 placeholder-gray-500"
        />
        <button
          onClick={handleSignup}
          disabled={loading || !email}
          className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
        >
          {loading ? 'Setting up...' : 'Get my forwarding address'}
        </button>
      </div>
    </main>
  )
}
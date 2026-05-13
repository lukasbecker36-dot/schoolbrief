'use client'

import { useState } from 'react'

const YEAR_LEVELS = [
  'Nursery',
  'Reception',
  'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6',
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11',
  'Year 12', 'Year 13'
]

export default function Manage() {
  const [email, setEmail] = useState('')
  const [verified, setVerified] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [children, setChildren] = useState<any[]>([])
  const [newName, setNewName] = useState('')
  const [newYear, setNewYear] = useState('Year 1')
  const [newSchool, setNewSchool] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [secondaryEmail, setSecondaryEmail] = useState('')
  const [savingSecondary, setSavingSecondary] = useState(false)
  const [secondarySaved, setSecondarySaved] = useState(false)

  async function handleVerify() {
    setLoading(true)
    setError('')
    const res = await fetch('/api/manage/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    const data = await res.json()
    if (data.user) {
      setUser(data.user)
      setSecondaryEmail(data.user.secondary_email || '')
      setChildren(data.children)
      setVerified(true)
    } else {
      setError('No account found for that email address')
    }
    setLoading(false)
  }

  async function handleAddChild() {
    if (!newName.trim()) return
    setLoading(true)
    setError('')
    const res = await fetch('/api/manage/children', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, name: newName, yearLevel: newYear, schoolName: newSchool })
    })
    const data = await res.json()
    if (data.child) {
      setChildren([...children, data.child])
      setNewName('')
      setNewSchool('')
      setSuccess('Child added!')
      setTimeout(() => setSuccess(''), 3000)
    } else {
      setError('Failed to add child')
    }
    setLoading(false)
  }

  async function handleDeleteChild(childId: string) {
    const res = await fetch('/api/manage/children', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId })
    })
    if (res.ok) {
      setChildren(children.filter(c => c.id !== childId))
    }
  }

  async function handleUpdateYear(childId: string, yearLevel: string) {
    const res = await fetch('/api/manage/children', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId, yearLevel })
    })
    if (res.ok) {
      setChildren(children.map(c => c.id === childId ? { ...c, year_level: yearLevel } : c))
      setSuccess('Updated!')
      setTimeout(() => setSuccess(''), 3000)
    }
  }

  async function handleSaveSecondaryEmail() {
    setSavingSecondary(true)
    setSecondarySaved(false)
    const res = await fetch('/api/manage/secondary-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, email: secondaryEmail })
    })
    if (res.ok) {
      setSecondarySaved(true)
      setTimeout(() => setSecondarySaved(false), 3000)
    } else {
      setError('Failed to save secondary email')
    }
    setSavingSecondary(false)
  }

  if (!verified) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
          <a href="/" className="text-blue-600 text-sm mb-6 inline-block">← Back</a>
          <div className="text-3xl mb-4">👨‍👩‍👧‍👦</div>
          <h1 className="text-2xl font-bold mb-2 text-gray-900">Manage your children</h1>
          <p className="text-gray-600 mb-6 text-sm">Enter your email to access your account.</p>
          <input
            type="email"
            placeholder="Your email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full border rounded-lg p-3 mb-4 text-sm text-gray-900 placeholder-gray-500"
          />
          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
          <button
            onClick={handleVerify}
            disabled={loading || !email}
            className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
          >
            {loading ? 'Looking up...' : 'Access my account'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 py-16 px-6">
      <div className="max-w-xl mx-auto">
        <a href="/" className="text-blue-600 text-sm mb-6 inline-block">← Back</a>
        <h1 className="text-2xl font-bold mb-1 text-gray-900">Your children</h1>
        <p className="text-gray-500 text-sm mb-8">SchoolBrief will filter events to match your children's year levels and schools.</p>

        {success && <p className="text-green-600 text-sm mb-4 bg-green-50 p-3 rounded-lg">{success}</p>}
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {/* Existing children */}
        <div className="space-y-3 mb-8">
          {children.length === 0 && (
            <p className="text-gray-400 text-sm">No children added yet.</p>
          )}
          {children.map(child => (
            <div key={child.id} className="bg-white border rounded-lg p-4 flex items-center gap-4">
              <div className="text-2xl">🧒</div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{child.name}</p>
                <p className="text-xs text-gray-500 mt-1">{child.school_name || 'No school set'}</p>
                <select
                  value={child.year_level}
                  onChange={e => handleUpdateYear(child.id, e.target.value)}
                  className="text-sm text-gray-600 mt-1 border rounded p-1"
                >
                  {YEAR_LEVELS.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => handleDeleteChild(child.id)}
                className="text-red-400 hover:text-red-600 text-sm"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* Add new child */}
        <div className="bg-white border rounded-lg p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Add a child</h2>
          <input
            type="text"
            placeholder="Child's name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 placeholder-gray-500"
          />
          <input
            type="text"
            placeholder="School name (e.g. Windmills Junior School)"
            value={newSchool}
            onChange={e => setNewSchool(e.target.value)}
            className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 placeholder-gray-500"
          />
          <select
            value={newYear}
            onChange={e => setNewYear(e.target.value)}
            className="w-full border rounded-lg p-3 mb-4 text-sm text-gray-900"
          >
            {YEAR_LEVELS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleAddChild}
            disabled={loading || !newName.trim()}
            className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add child'}
          </button>
        </div>

        {/* Secondary email */}
        <div className="bg-white border rounded-lg p-5 mt-8">
          <h2 className="font-semibold text-gray-900 mb-2">Send digest to a second email</h2>
          <p className="text-gray-500 text-xs mb-4">Add another email address (e.g. your partner) to receive the daily digest too.</p>
          <input
            type="email"
            placeholder="partner@example.com (leave blank for none)"
            value={secondaryEmail}
            onChange={e => setSecondaryEmail(e.target.value)}
            className="w-full border rounded-lg p-3 mb-3 text-sm text-gray-900 placeholder-gray-500"
          />
          <button
            onClick={handleSaveSecondaryEmail}
            disabled={savingSecondary}
            className="w-full bg-blue-600 text-white rounded-lg p-3 font-medium disabled:opacity-50 text-sm"
          >
            {savingSecondary ? 'Saving...' : secondarySaved ? '✓ Saved!' : 'Save secondary email'}
          </button>
        </div>

        {/* Forwarding address reminder */}
        <div className="mt-8 bg-gray-100 rounded-lg p-4">
          <p className="text-xs text-gray-500 mb-1">Your forwarding address</p>
          <p className="font-mono text-sm text-gray-900 break-all">{user.inbound_address}</p>
        </div>
      </div>
    </main>
  )
}
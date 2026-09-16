export type SignedInUser = { email: string; inbound_address: string }

// Top-right indicator on the front page showing who is signed in, so a parent
// returning to the homepage can see they don't need to log in again. Links to
// their account. Renders nothing when signed out.
export default function SignedInBadge({ user }: { user: SignedInUser | null }) {
  if (!user) return null

  return (
    <a
      href="/manage"
      className="absolute top-4 right-4 left-4 sm:left-auto bg-white border rounded-lg shadow-sm px-4 py-2 hover:border-blue-400 transition text-right"
    >
      <p className="text-xs font-medium text-green-700">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 align-middle" />
        Logged in
      </p>
      <p className="text-sm text-gray-900 break-all">{user.email}</p>
      <p className="text-xs text-gray-500 font-mono break-all">{user.inbound_address}</p>
    </a>
  )
}

// The two ways to stop forwarding school emails by hand, shown after signup and
// on the manage page. Shared so the two can't drift apart.
//
// Outlook/Hotmail connects directly. Gmail is a forwarding rule the parent sets
// up themselves: the Gmail connector's refresh tokens expire after seven days
// while the Google app is unverified, so a guide is the version that keeps
// working.
export default function EmailAutomationOptions() {
  return (
    <div className="space-y-4">
      <div>
        <a
          href="/api/outlook/connect"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-5 py-3 font-medium text-sm w-full text-center"
        >
          Outlook / Hotmail →
        </a>
        <p className="text-xs text-gray-500 text-center mt-1">Click for quick signup</p>
      </div>

      <div>
        <a
          href="/gmail-guide"
          className="block border border-gray-300 hover:border-blue-400 hover:bg-blue-50 rounded-lg px-5 py-3 text-sm text-center transition"
        >
          <span className="font-medium text-gray-900">Gmail</span>
          <span className="text-gray-700"> — step-by-step guide to setting up autoforwarding →</span>
        </a>
        <p className="text-xs text-gray-500 text-center mt-1">
          Must be done on a desktop browser · estimated time 5 minutes
        </p>
      </div>
    </div>
  )
}

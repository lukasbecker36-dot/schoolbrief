export const metadata = {
  title: 'Privacy Policy — SchoolBrief'
}

export default function Privacy() {
  return (
    <main className="min-h-screen bg-gray-50 py-16 px-6">
      <div className="max-w-2xl mx-auto">
        <a href="/" className="text-blue-600 text-sm mb-8 inline-block">← Back</a>

        <h1 className="text-4xl font-bold mb-2 text-gray-900">Privacy Policy</h1>
        <p className="text-gray-500 mb-10 text-sm">Last updated: 28 June 2026</p>

        <div className="space-y-8 text-gray-700 text-sm leading-relaxed">
          <section>
            <p>
              SchoolBrief ("we", "us") turns school emails into a daily summary for parents. This policy explains
              what we collect, how we use it, and the choices you have. Questions? Email{' '}
              <a href="mailto:schoolbriefapp@gmail.com" className="text-blue-600 underline">schoolbriefapp@gmail.com</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">What we collect</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Your email address, and optionally a second parent's email for the digest.</li>
              <li>Details you add about your children (name, year group, school) to tailor the summary.</li>
              <li>The content of school emails you forward to us, or — if you connect Gmail — school emails we access on your behalf.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">How we use it</h2>
            <p>
              We process school emails to extract events, deadlines, notices and learning summaries, and send you a
              daily digest. To do this we use trusted processors: Anthropic (AI extraction), Supabase (database),
              and Resend (sending email). We do not sell your data or use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Connecting your Gmail</h2>
            <p className="mb-3">
              If you choose to connect Gmail, we request read-only access so we can pick up school emails
              automatically instead of you forwarding them. We only read messages from the school senders you tell
              us about — not your wider inbox — and we never send email on your behalf.
            </p>
            <p>
              SchoolBrief's use and transfer of information received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-blue-600 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We use Gmail data solely to provide the SchoolBrief digest
              to you, do not transfer it to others except as needed to provide that feature, do not use it for
              advertising, and do not allow humans to read it except where you give explicit consent, for security
              or to comply with the law. You can disconnect Gmail at any time, which revokes our access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Retention</h2>
            <p>
              Extracted events and notices expire automatically (notices after a day, learning summaries after a
              week, events after they pass). Original email content is deleted within 30 days. You can ask us to
              delete your account and all associated data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Security</h2>
            <p>
              Data is stored with access restricted to our server only. Gmail access tokens are encrypted at rest.
              We use reputable infrastructure providers and take reasonable measures to protect your information.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Your rights</h2>
            <p>
              Under UK GDPR you can request access to, correction of, or deletion of your personal data, and
              withdraw consent at any time. Contact{' '}
              <a href="mailto:schoolbriefapp@gmail.com" className="text-blue-600 underline">schoolbriefapp@gmail.com</a>{' '}
              and we'll action it.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}

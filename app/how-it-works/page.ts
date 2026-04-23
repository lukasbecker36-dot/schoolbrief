export default function HowItWorks() {
  return (
    <main className="min-h-screen bg-gray-50 py-16 px-6">
      <div className="max-w-2xl mx-auto">
        <a href="/" className="text-blue-600 text-sm mb-8 inline-block">← Back</a>
        
        <h1 className="text-4xl font-bold mb-4 text-gray-900">How SchoolBrief works</h1>
        <p className="text-gray-600 mb-12 text-lg">Set it up once in 5 minutes. Never miss a school event again.</p>

        <div className="space-y-12">
          
          <section>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">1</span>
              <h2 className="text-2xl font-bold text-gray-900">Sign up and get your address</h2>
            </div>
            <p className="text-gray-700 mb-3">When you sign up, we give you a unique forwarding address that looks like:</p>
            <div className="bg-gray-100 rounded-lg p-3 font-mono text-sm text-gray-900">xt2ywzev@in.schoolbrief.uk</div>
            <p className="text-gray-600 text-sm mt-3">This is your personal address — emails sent here get summarised for you.</p>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">2</span>
              <h2 className="text-2xl font-bold text-gray-900">Set up email forwarding</h2>
            </div>
            <p className="text-gray-700 mb-4">In Gmail, set up an automatic filter so school emails forward to SchoolBrief:</p>
            
            <ol className="space-y-2 text-gray-700 list-decimal list-inside ml-2">
              <li>Open Gmail → click the cog icon → <strong>See all settings</strong></li>
              <li>Click the <strong>Filters and Blocked Addresses</strong> tab</li>
              <li>Click <strong>Create a new filter</strong></li>
              <li>In the <strong>From</strong> field, enter your school's email domain (e.g. <code className="bg-gray-100 px-2 py-1 rounded text-sm">*@yourschool.sch.uk</code>)</li>
              <li>Click <strong>Create filter</strong></li>
              <li>Tick <strong>Forward it to</strong> and add your SchoolBrief address</li>
              <li>You'll need to verify the forwarding address once — we'll send you a confirmation code</li>
              <li>Click <strong>Create filter</strong></li>
            </ol>

            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mt-4 rounded">
              <p className="text-sm text-blue-900"><strong>Tip:</strong> Not sure what your school's email domain is? Look at a recent email from them — it's whatever comes after the @ sign.</p>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-3 mb-3">
              <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm">3</span>
              <h2 className="text-2xl font-bold text-gray-900">Get your daily digest</h2>
            </div>
            <p className="text-gray-700 mb-3">Every morning at 7am you'll receive one email covering the week ahead:</p>
            <div className="bg-white border rounded-lg p-5 text-sm">
              <p className="font-bold text-blue-600 mb-3">📅 Your school week ahead</p>
              <p className="font-semibold text-gray-900 mb-1">Wednesday 30 April</p>
              <p className="text-gray-700 mb-3">Book Fair — bring £5 if your child wants to buy a book.</p>
              <p className="font-semibold text-gray-900 mb-1">Thursday 1 May</p>
              <p className="text-gray-700 mb-3">Sports Day — children should wear something yellow.</p>
              <p className="font-semibold text-gray-900 mb-1">Friday 2 May</p>
              <p className="text-gray-700">Permission slip for museum trip due today.</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-3 text-gray-900">Frequently asked questions</h2>
            <div className="space-y-4 mt-6">
              <div>
                <p className="font-semibold text-gray-900 mb-1">Is my email private?</p>
                <p className="text-gray-700 text-sm">Yes. We only process forwarded school emails to extract events. Original emails are deleted after 30 days and we never share your data.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">What if multiple children go to different schools?</p>
                <p className="text-gray-700 text-sm">Just forward emails from all their schools to the same address. Everything ends up in one morning digest.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">What if an event date is wrong?</p>
                <p className="text-gray-700 text-sm">AI isn't perfect. If something looks off, always check the original school email. We're working on flagging low-confidence events.</p>
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">How much does it cost?</p>
                <p className="text-gray-700 text-sm">Free during the private beta. We'll let you know well in advance if that changes.</p>
              </div>
            </div>
          </section>

          <section className="text-center pt-8 border-t">
            <p className="text-gray-600 mb-4">Ready to stop missing school events?</p>
            <a href="/" className="inline-block bg-blue-600 text-white rounded-lg px-6 py-3 font-medium">Sign up with your invite code</a>
          </section>

        </div>
      </div>
    </main>
  )
}
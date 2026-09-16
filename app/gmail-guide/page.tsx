import Image, { type StaticImageData } from 'next/image'
import YourAddress from './YourAddress'
import gmail1 from './_screenshots/gmail1.png'
import gmail2 from './_screenshots/gmail2.png'
import gmail3 from './_screenshots/gmail3.png'
import gmail4 from './_screenshots/gmail4.png'
import gmail5 from './_screenshots/gmail5.png'
import gmail6 from './_screenshots/gmail6.png'
import gmail7 from './_screenshots/gmail7.png'
import gmail8 from './_screenshots/gmail8.png'
import gmail9 from './_screenshots/gmail9.png'

export const metadata = {
  title: 'Gmail autoforwarding guide — SchoolBrief'
}

type Step = {
  text: React.ReactNode
  image: StaticImageData
  alt: string
  showAddress?: boolean
}

const steps: Step[] = [
  {
    text: 'Open up your Gmail inbox on your desktop computer, and click on the gear near the top (see red box).',
    image: gmail1,
    alt: 'The settings gear icon at the top right of Gmail, highlighted'
  },
  {
    text: <>Click on <strong>See all settings</strong>.</>,
    image: gmail2,
    alt: 'The Quick settings panel with See all settings highlighted'
  },
  {
    text: <>Click the <strong>Forwarding and POP/IMAP</strong> tab.</>,
    image: gmail3,
    alt: 'The Gmail settings tabs with Forwarding and POP/IMAP highlighted'
  },
  {
    text: (
      <>
        Click <strong>Add a forwarding address</strong>, and add your SchoolBrief individual email address in
        the popup box (e.g. <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">xhdg56st@in.schoolbrief.uk</code>).
      </>
    ),
    image: gmail4,
    alt: 'The Forwarding section with the Add a forwarding address button highlighted',
    showAddress: true
  },
  {
    text: 'Go to your inbox and you will have received an email confirming the autoforward. Click the link to confirm.',
    image: gmail5,
    alt: 'The SchoolBrief email relaying Gmail’s forwarding confirmation, with the confirmation link highlighted'
  },
  {
    text: (
      <>
        Repeat Steps 1 and 2 to get back into the settings menu. Then click the{' '}
        <strong>Filters and Blocked Addresses</strong> tab.
      </>
    ),
    image: gmail6,
    alt: 'The Gmail settings tabs with Filters and Blocked Addresses highlighted'
  },
  {
    text: <>Click <strong>Create a new filter</strong>.</>,
    image: gmail7,
    alt: 'The filters page with Create a new filter highlighted'
  },
  {
    text: (
      <>
        Enter the address the school email comes from. If there are multiple schools or email addresses,
        separate them with the word <strong>OR</strong> (e.g.{' '}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">office@school.com OR office2@school2.com</code>).
        Then click <strong>Create filter</strong>.
      </>
    ),
    image: gmail8,
    alt: 'The filter form with a school address in the From field and Create filter highlighted'
  },
  {
    text: (
      <>
        Click <strong>Forward it to</strong>, and select your SchoolBrief email from the dropdown list. Then
        click <strong>Create filter</strong> and you’re all done.
      </>
    ),
    image: gmail9,
    alt: 'The filter actions with Forward it to and Create filter highlighted'
  }
]

export default function GmailGuide() {
  return (
    <main className="min-h-screen bg-gray-50 py-16 px-6">
      <div className="max-w-2xl mx-auto">
        <a href="/manage" className="text-blue-600 text-sm mb-8 inline-block">← Back</a>

        <h1 className="text-3xl font-bold mb-3 text-gray-900">Step-by-step to setting up Gmail autoforwarding</h1>
        <p className="text-gray-600 mb-12">
          This needs to be done on a desktop browser, and takes about 5 minutes.
        </p>

        <ol className="space-y-12">
          {steps.map((step, i) => (
            <li key={i}>
              <div className="flex items-center gap-3 mb-3">
                <span className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm shrink-0">
                  {i + 1}
                </span>
                <h2 className="text-xl font-bold text-gray-900">Step {i + 1}</h2>
              </div>
              <p className="text-gray-700 mb-4">{step.text}</p>
              {step.showAddress && <YourAddress />}
              <Image
                src={step.image}
                alt={step.alt}
                sizes="(max-width: 768px) 100vw, 672px"
                className="w-full h-auto rounded-lg border border-gray-200 bg-white mt-4"
              />
            </li>
          ))}
        </ol>

        <div className="text-center pt-12 mt-12 border-t">
          <a
            href="/manage"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-8 py-3 font-medium"
          >
            I’m all done →
          </a>
        </div>
      </div>
    </main>
  )
}

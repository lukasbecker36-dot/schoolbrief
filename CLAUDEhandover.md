# SchoolBrief — CLAUDE.md

## What is SchoolBrief?

SchoolBrief (schoolbrief.uk) is an AI-powered service that turns school emails into a daily morning digest for parents. Parents forward their school emails to a unique inbound address, Claude extracts events/notices/learning summaries, and a daily email is sent at 6am UTC with everything organised into clear sections.

Live at: https://schoolbrief.uk
GitHub: github.com/lukasbecker36-dot/schoolbrief

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Hosting:** Vercel (hobby plan, auto-deploys from GitHub main branch)
- **Database:** Supabase (PostgreSQL + Row Level Security)
- **Email Ingestion:** SendGrid Inbound Parse → webhook at /api/webhooks/email
- **AI Extraction:** Anthropic Claude Sonnet 4.6 API
- **Outbound Email:** Resend (digest emails from digest@schoolbrief.uk)
- **DNS/Domain:** Cloudflare (schoolbrief.uk)
- **Cron:** Vercel Cron Jobs (vercel.json)

## Architecture Overview

```
Parent forwards school email
    ↓
*@in.schoolbrief.uk (MX → mx.sendgrid.net)
    ↓
SendGrid Inbound Parse POSTs to /api/webhooks/email
    ↓
mailparser extracts body, subject, attachments
    ↓
PDF attachments sent to Claude (real attachments + URLs fetched from email body)
.eml attachments parsed recursively for inner content
    ↓
Claude Sonnet 4.6 extracts structured JSON:
  - events (school calendar items)
  - other_events (community/commercial)
  - notices (short-term announcements)
  - learning (weekly class overviews)
    ↓
Saved to Supabase (events table + notices table)
    ↓
Daily cron at 6am UTC → /api/digest
    ↓
For each user: query events + notices → format HTML email → send via Resend
```

## Database Schema

### users
- id (UUID, PK)
- email (TEXT, UNIQUE) — parent's real email
- inbound_address (TEXT, UNIQUE) — e.g. xt2ywzev@in.schoolbrief.uk
- secondary_email (TEXT, nullable) — second parent's email for digest
- created_at (TIMESTAMPTZ)

### children
- id (UUID, PK)
- user_id (UUID, FK → users)
- name (TEXT)
- year_level (TEXT) — e.g. "Year 5", "Reception"
- school_name (TEXT) — e.g. "Windmills Junior School"
- created_at (TIMESTAMPTZ)

### events
- id (UUID, PK)
- user_id (UUID, FK → users)
- child_id (UUID, FK → children, nullable)
- title (TEXT)
- event_date (DATE)
- description (TEXT)
- action_required (BOOLEAN, default false)
- source_email_subject (TEXT)
- school_name (TEXT, nullable)
- is_school_event (BOOLEAN, default true) — false for community/commercial events
- created_at (TIMESTAMPTZ)

### notices
- id (UUID, PK)
- user_id (UUID, FK → users)
- child_id (UUID, FK → children, nullable)
- school_name (TEXT)
- category (TEXT) — 'notice' or 'learning'
- title (TEXT)
- content (TEXT)
- expires_at (DATE) — notices expire after 1 day, learning after 7 days
- created_at (TIMESTAMPTZ)

### RLS Policy
All public/anon RLS policies have been REMOVED. The app uses the Supabase service_role key server-side only. The anon key (exposed in NEXT_PUBLIC_ vars) cannot access any tables. This was a deliberate security hardening step.

## File Structure

```
app/
  page.tsx                          — Homepage/signup (invite code gated)
  layout.tsx                        — Root layout with page title/meta
  how-it-works/
    page.tsx                        — Instructions page (Gmail, Outlook, Apple Mail)
  manage/
    page.tsx                        — Children management + secondary email
  api/
    signup/
      route.ts                      — POST: create user with unique inbound address
    webhooks/
      email/
        route.ts                    — POST: main email processing pipeline
    digest/
      route.ts                      — GET: daily digest cron endpoint
      format.ts                     — Shared email formatting functions
    manage/
      verify/
        route.ts                    — POST: look up user by email
      children/
        route.ts                    — POST/DELETE/PATCH: manage children
      secondary-email/
        route.ts                    — POST: set secondary email
    admin/
      dedupe/
        route.ts                    — GET: AI-powered event deduplication
      send-digest/
        route.ts                    — GET: send digest for a single user (?email=...)
lib/
  supabase.ts                      — Supabase client (uses SERVICE_ROLE_KEY)
vercel.json                         — Cron config (6am UTC daily)
```

## Environment Variables

All set in Vercel + local .env.local:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL (no trailing /rest/v1/)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (locked down, can't access anything)
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server-side only, NEVER expose)
- `ANTHROPIC_API_KEY` — Claude API key
- `RESEND_API_KEY` — Resend email sending key
- `CRON_SECRET` — Auth token for cron/admin endpoints
- `INVITE_CODES` — Comma-separated invite codes (e.g. EARLYBIRD2026,FRIENDSFAMILY)

## Key Design Decisions

### Email Ingestion
- Each user gets a unique address like `xt2ywzev@in.schoolbrief.uk`
- Catch-all MX record on `in.schoolbrief.uk` → `mx.sendgrid.net`
- SendGrid Inbound Parse POSTs to webhook
- Webhook always returns 200 (even on errors) to prevent SendGrid retries

### Gmail Forwarding Confirmation
- When Gmail sends a forwarding confirmation to the inbound address, the webhook detects it (checks sender = forwarding-noreply@google.com or subject contains "forwarding confirmation")
- Automatically forwards the confirmation email to the parent's real inbox via Resend so they can click the link

### PDF Handling
- Real PDF attachments: extracted from MIME, sent as base64 documents to Claude
- PDF URLs in email body: regex-matched (https://...*.pdf), fetched via HTTP, sent to Claude. This handles ParentMail which hosts PDFs behind tokenised URLs rather than attaching them
- .eml attachments: parsed recursively with mailparser to extract inner content and PDFs

### AI Extraction (Claude Sonnet 4.6)
The prompt classifies email content into 4 categories:

1. **SCHOOL EVENTS** — dated calendar items organised by the school. Year-group filtered against children. Child-prefixed titles (e.g. "James — Brighton Trip"). Deduped against existing events in DB.

2. **NOTICES** — short-term announcements (staffing changes, policy updates). Expire after 1 day. Deduped by fuzzy title matching.

3. **LEARNING** — weekly class overviews per child. Expire after 7 days. New entries DELETE the previous one for that child (replacement, not accumulation).

4. **OTHER EVENTS** — community/commercial events mentioned in school emails. Stored with is_school_event=false.

### Year Group Filtering
The prompt has a CATEGORICAL rule: if an event specifies a year group, it MUST match one of the parent's children at that specific school. Events for other year groups are omitted entirely (not included "for context").

### Deduplication
Two layers:
1. **At extraction time:** existing events for the user are included in the prompt context. Claude is instructed to skip anything already in the calendar unless fundamentally changed (cancelled, moved date).
2. **Admin dedupe endpoint:** /api/admin/dedupe runs Claude against all same-date events per user to identify and merge duplicates, keeping the most detailed version.

### Digest Email Structure (in order)
1. 📌 **Notices** — active notices (expires_at >= today)
2. 📅 **This week** — school events in next 7 days, grouped by date
3. 📚 **This week's learning** — active learning entries per child
4. 🔭 **Looking ahead** — school events 8-30 days out, listed format
5. 🎉 **Other events & activities** — community events, compact one-line format

Sent from: SchoolBrief <digest@schoolbrief.uk>
Subject: 📅 Your school week ahead — [day, date month]
Also sent to secondary_email if set.

### Security
- Database access: service_role key only (server-side). Anon key is exposed in browser JS but all RLS policies removed so it can't read/write anything.
- Admin endpoints (/api/digest, /api/admin/*) protected by CRON_SECRET bearer token.
- Signup gated by invite codes (configurable via env var).
- Manage page: currently no auth (known limitation — anyone who knows a parent's email can access). To be fixed with proper auth before public launch.

## Pricing Model (planned)
- Introductory: £1.99/month or £16.99/year per family
- Standard: £2.99/month (for new signups after beta)
- API cost per family: ~£1.00-1.50/month on Sonnet 4.6

## Known Issues & TODO

### Recurring Issues
- **Year-group filtering sometimes fails:** Claude occasionally includes events for year groups the children aren't in, especially from newsletter diary date lists. Prompt has been strengthened repeatedly but edge cases persist.
- **Duplicate events from different emails:** When the same event is mentioned across multiple emails with slightly different wording, deduplication sometimes misses it. The admin/dedupe endpoint helps but isn't perfect.
- **Same-day/next-day events:** Very short-notice events (happening today/tomorrow) sometimes get skipped because they don't fit neatly into the "future event" category. A recent prompt addition captures these as notices.

### TODO (priority order)
1. **Privacy policy page** — legally needed before wider launch (UK GDPR)
2. **Authentication on /manage page** — currently anyone who knows a parent's email can access
3. **Token usage tracking** — token_usage table planned but not yet implemented
4. **Rate limiting** on signup and webhook endpoints
5. **Edit school name** on manage page without deleting/re-adding child
6. **Pause digest** — let parents pause during holidays with a resume date
7. **Image attachment support** — for screenshots of ClassDojo etc
8. **Stripe paywall** — when ready to charge
9. **Terms of service**

### Admin Commands

```bash
# Send digest to ALL users (runs automatically at 6am UTC via cron)
curl https://schoolbrief.uk/api/digest -H "Authorization: Bearer $CRON_SECRET"

# Send digest to ONE user only
curl "https://schoolbrief.uk/api/admin/send-digest?email=user@example.com" -H "Authorization: Bearer $CRON_SECRET"

# Run deduplication across all users
curl https://schoolbrief.uk/api/admin/dedupe -H "Authorization: Bearer $CRON_SECRET"
```

### Users (as of June 2026)
- lukasbecker36@gmail.com (founder/test user, 3 children: James Y5 Windmills, Sam Y2 Hassocks Infants, Rowan Reception Hassocks Infants)
- simonlegg0@gmail.com (beta tester)

### Schools Tested
- Windmills Junior School (sends via Scopay, direct email)
- Hassocks Infant School (sends via ParentMail — PDFs hosted at pmx.parentmail.co.uk with tokenised URLs)

### Important Notes
- .env.local is gitignored — never commit secrets
- myNotes.txt is gitignored — previously accidentally committed and blocked by GitHub push protection
- When redeploying on Vercel after env var changes, make sure to redeploy the LATEST commit (not an older one — Vercel's "Redeploy" reuses the commit that build was based on)
- SendGrid Inbound Parse is configured for in.schoolbrief.uk with "POST raw MIME" enabled
- Resend domain authentication is set up for schoolbrief.uk
- The webhook always returns 200, even on errors, to prevent SendGrid retry loops

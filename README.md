# AADI Rifle Shooting — Academy Management

Initial web MVP: admin sign-in, shooter registration, one-time QR card issuance, camera QR scanning, check-in/check-out and optional rifle allocation.

## 1. Requirements
- Node.js 20 LTS or newer
- A Supabase project
- Browser camera access (localhost or HTTPS)

## 2. Supabase setup
1. Open your Supabase project → SQL Editor.
2. Run `supabase/migrations/001_initial_schema.sql`.
3. In Authentication → Users, create the academy admin user.
4. Copy that user's UUID and run this SQL (replace values):

```sql
insert into public.profiles (id, full_name, role)
values ('AUTH_USER_UUID', 'Academy Admin', 'super_admin');
```

5. Add starter rifles if desired:

```sql
insert into public.rifles (rifle_code, name) values
('RIFLE-01', 'Air Rifle 01'),
('RIFLE-02', 'Air Rifle 02');
```

The SQL uses `pgcrypto` for hashing QR tokens. Only the SHA-256 hash is stored; the raw QR token is shown once when issued. If a card is lost, issue a new QR to revoke the previous token.

## 2a. One-command database setup (optional, replaces manual SQL steps)
```powershell
cd web
Copy-Item .env.db.example .env.db     # then edit .env.db: paste DATABASE_URL (Session pooler) and ADMIN_EMAIL
npm install
npm run db:setup
```
It applies every file in `supabase/migrations` in order (already-applied files are skipped), reloads the API schema cache, and makes `ADMIN_EMAIL` a super_admin. Create that user first in Authentication -> Users.

## 2b. Shooter sign-up and approval (run migration 002)
Run `supabase/migrations/002_shooter_signup_approval.sql` in the SQL Editor after migration 001.

How it works:
1. A shooter opens the app → **New shooter** tab → creates an account (email + password).
2. After signing in they fill in their details. Their status is **Pending approval**; they cannot check in yet.
3. The admin signs in, opens **Approvals**, and clicks **Approve** (or Reject). Approval activates the shooter and immediately shows their QR card to save or print.
4. The shooter signs in again and sees **You're an AADI member** with their membership ID.

Supabase tip: for easy local testing, turn off Authentication → Providers → Email → "Confirm email". Leave it on in production.

## 2c. Family accounts: parents and children on one email (run migration 021)
One login (one email) can now hold several people, for example a parent and two children, or just the children.
Each person is still a separate shooter with their **own membership ID, approval, QR pass, attendance, scores, fees, matches and alerts**. Only the login is shared.

How it looks to the family
1. The parent creates one account with the family email (the sign-up page explains this).
2. A short form asks **Who is joining?** — *Myself*, *My child* or *Another family member*. Guardian details are pre-filled from earlier members, so the parent never types them twice.
3. After signing in, a **Who's training today?** screen shows one card per person with a plain status (Awaiting approval / Active / Needs changes), their unread alerts and an **Add a family member** card. A person with only one member goes straight to their dashboard, exactly as before.
4. A switcher in the dashboard header changes member in one tap. Up to 6 members per login.

How it looks to the academy
- **Approvals** shows a *Child / Family account (3 members)* tag, and the admin alert says "family account with 2 other members". Each person is approved or rejected separately.
- Fee emails and phone alerts that go to a shared inbox name the member ("Aarav – Fee reminder: …", "Aarav: New fee added") so parents know which child they are about.

Deploying this update
1. Apply the database change: `npm run db:setup` (or run `supabase/migrations/021_family_accounts.sql` in the SQL Editor). Existing single-member accounts keep working unchanged.
2. Redeploy the two edge functions that changed: `supabase functions deploy fee-mail` and `supabase functions deploy push-notify`.
3. Deploy the web app.

Quick test after deploying: sign up with a new email, register a child, add yourself, add a second child. Approve all three as admin. Sign in again, switch member, open **My QR** for each, and check that each shows a different name and that checking one in does not affect the others.

Technical notes
- `shooters.user_id` is no longer unique. Reading data is allowed for every member on the login (`my_shooter_ids()`); actions "as me" use `my_shooter_id()`, which honours the `x-aadi-member` header the web app sends, but only if that member belongs to the signed-in login.
- The saved QR is stored per member in the browser. A QR already saved by an existing single-member user is migrated automatically on first load.

## 3. Run the web application

```powershell
cd web
Copy-Item .env.example .env
```

Edit `web/.env` and add your Supabase URL and publishable/anon key:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY
```

Then:

```powershell
npm install
npm run dev
```

Open the localhost URL printed by Vite. Sign in with the admin user created in Supabase.

## 4. Important security and operating notes
- Never use the Supabase `service_role` key in the browser or commit `.env` to Git.
- The database policies restrict the initial admin workflows to authenticated academy admin/reception roles. The first admin profile must be provisioned manually as above.
- Use HTTPS in production for camera scanning.
- QR codes contain random opaque tokens, not personal details. The database stores only token hashes.
- A scan is not a safety authorization. Follow the academy's normal firearm/range supervision and equipment issue procedures.
- This is an initial MVP scaffold, not yet production-ready. Add profile/role administration, batch and coach assignment, audit history, backups, testing, rate limits and deployment configuration before live academy use.

## 5. Current MVP scope
- Dashboard statistics and recent attendance
- Shooter registration and directory
- Generate/download/print a QR card
- Reissue QR (revokes prior QR)
- Camera scanner for check-in and check-out
- Optional rifle inventory selection and allocation/return

Next phases: batches/coaches, notifications page, mobile app, and automated tests.

## 6. Shooter portal, scores and offline fees (migrations 004 + 005)
Run `npm run db:setup` again (or paste `004_scores_and_portal_access.sql` and `005_fees_and_payments.sql` into the SQL Editor).

**Shooter portal** (approved, active members see this after signing in):
- Overview: "Where to improve" tips and "What's going well", plus a banner if a fee is overdue or due soon
- Attendance: days attended, this month, last 30 days, and each session's in/out time
- Scores: average, best, trend, progress chart and every recorded score
- Fees: what is due, what is paid (date and method)
- My QR: the membership QR card

**Admin**
- **Shooting scores**: click *Record score*. Entering shot-by-shot values unlocks deeper tips (slow starts, fading late, stray shots)
- **Fees & payments**: *Add fee* for one shooter or everyone; summary cards for pending / overdue / collected; *Remind* sends a reminder; *Mark paid* records cash/UPI and emails the shooter a "payment received" receipt; *Resend receipt* and *Undo* are there too. The *Email activity* table shows whether each email was sent or failed.

**Manual check-in** (Attendance page → *Manual check-in / check-out*): if the camera or QR isn't available, search by name, AADI number or phone and click *Check in* / *Check out*. Needs migration `006`. Manual entries are marked in the attendance notes.

Payments are collected **offline** at the academy. The app only records them and sends the emails.

### Turn on the emails (one-time)
1. Create a free account at resend.com, verify your sending domain, and create an API key.
2. Deploy the function and set its secrets (needs the Supabase CLI):
```powershell
supabase functions deploy fee-mail --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_xxx MAIL_FROM="AADI Rifle Shooting <fees@yourdomain.com>" CRON_SECRET=any-long-random-string
```
3. Optional but recommended: open `supabase/cron-fee-reminders.sql`, fill in your project ref, anon key and the same CRON_SECRET, then run it in the SQL Editor. This emails every shooter with an unpaid fee starting 3 days before the due date, then every 3 days until it is marked paid (09:00 India time daily).

Reminders and receipts go to the email stored on the shooter's record. Shooters who sign up themselves get their login email automatically; for shooters you register by hand, fill in the Email field.


## 7. Public website and refreshed dashboards
The latest interface update adds a public-facing academy website at `/` with the supplied AADI opening poster, training program information, Yelahanka location details, contact link, and clear **Sign in** / **Join the academy** actions. Visitors can view the site without creating an account. The poster is stored at `web/public/aadi-academy-poster.jpg`.

- `/login` is the member and staff sign-in page.
- `/signup` is the shooter account creation page. New shooter registrations still follow the existing approval workflow.
- Admin users are routed to the academy management workspace; approved shooters are routed to their member portal.
- The attendance desk has clearer check-in and check-out actions, a sound on/off control, a short success tone after successful QR or manual attendance actions, and optional browser notifications when permission is granted.
- The admin Notifications page combines recent pending shooter approvals, attendance updates and pending fee records. It refreshes when the page receives Supabase Realtime table events (if Realtime is enabled for those tables) and also has a manual Refresh control.

Browser notifications and sound require the staff member to open the attendance page and enable sound/notification permission. This is not a guaranteed push-notification service when the browser is closed. For production push notifications, configure a server-side notification provider and delivery rules.

## 8. Build and deploy
From `web/`, install dependencies and run `npm run build` before deploying the generated `dist/` folder to a static host such as Vercel or Netlify. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the hosting provider's environment settings. Use HTTPS for camera scanning. Configure the host to rewrite unknown paths to `index.html` so `/login` and `/signup` work on refresh.

## Membership exit / Past Shooters

Apply `supabase/migrations/008_shooter_exit_requests.sql` after the existing migrations. It adds:

- Shooter self-service leave request with a required reason.
- Admin leave-request review with approve/reject and optional review note.
- Approved shooters are moved to Past Shooters while attendance, scores and fee history remain available to the academy.
- Admin-only Restore to active membership.
- Admin-only permanent deletion for archived shooters.
- Notifications for leave requests, approvals, rejections and restored memberships.

The Shooter Notifications page now calculates the unread count independently from the visible notification list, so the tab badge and the page count stay consistent even when more than the visible page limit exists.

## Rejected application resubmission (migration 010)

Apply `supabase/migrations/010_rejected_shooter_resubmission.sql` after the existing migrations. It adds:

- Rejected shooters can correct their details and resubmit the same application without creating a second account or membership record.
- The shooter sees the rejection reason and an **Edit & resubmit application** form.
- Resubmission changes the application back to **Pending** for admin review.
- Admin receives a new `registration_resubmitted` notification for the corrected application.
- The existing membership ID is retained.

## Lock-screen phone notifications (Web Push)
Makes notifications appear on a locked phone even when the app is closed. Free. One-time setup:

1. **Make keys** (any computer with Node): `npx web-push generate-vapid-keys` → copy the Public and Private key.
2. **Render** → your site → Environment → add `VITE_VAPID_PUBLIC_KEY` = the **Public** key → redeploy.
3. **Database**: run `npm run db:setup` (applies migration 013), then in the Supabase SQL Editor run (fill in your project ref and a long random secret):
```sql
insert into public.push_config(key,value) values
 ('push_function_url','https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-notify'),
 ('push_webhook_secret','PUT-A-LONG-RANDOM-SECRET-HERE')
on conflict (key) do update set value = excluded.value;
```
4. **Edge Function** (Supabase CLI, in this repo's root):
```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_WEBHOOK_SECRET=PUT-A-LONG-RANDOM-SECRET-HERE
supabase functions deploy push-notify
```
5. On each phone: open the installed app → tap the single **Alerts** button (admin top bar) or **Turn on alerts** (member home) → Allow. One switch controls both the sound and the phone notifications.
   iPhone: needs iOS 16.4+ and the app added via Share → Add to Home Screen.

### Daily fee reminders in the app + phone (migration 014)
`npm run db:setup` also applies migration 014. Every day at 09:00 India time each pending fee sends the shooter an in-app notification (and a phone push) from 3 days before the due date, on the due date, and every day while overdue, until it is paid. Nobody needs to open the app. If it says pg_cron is unavailable, enable it in Supabase → Database → Extensions → `pg_cron`, then run `npm run db:setup` again. To run it right now for testing, in the SQL Editor: `select public.send_fee_app_reminders();`

### Troubleshooting phone alerts
- In the app tap **Test** (admin) / **Send test** (member) with the phone locked.
- Is the phone registered? `select count(*) from public.push_subscriptions;`
- Did the database reach the function? `select status_code, content from net._http_response order by created desc limit 5;` (200 = OK, 401 = secret mismatch, 404 = function not deployed)
- Function errors: Supabase → Edge Functions → push-notify → Logs.
- Android: Settings → Apps → Chrome/AADI → Battery → set to *Unrestricted* so the phone never delays alerts.


## Matches, registration and live positions (migration 015)

Run `npm run db:setup` to apply migration 015.

**Admin → Matches**
1. *Organise match* – name, date, discipline, venue, shots and maximum score. Every active shooter is notified.
2. Shooters register from the **Matches** tab in their portal while status is *Registration open*. You can also add or remove shooters yourself.
3. Open **Manage match** to add, edit or delete each shooter's score (with inner tens as the tie-breaker). The leaderboard re-ranks instantly.
4. Use the **Shooters can see their position** switch to give or take back permission per match.
5. Move the status through *Registration open → closed → Live → Completed*.

**Shooter → Matches** – register / withdraw, and (only when you allow it) see **their own** position and score, updating live. Shooters never see other shooters' names or scores; the database only returns their own rank.

### Sheet-wise scores and results (migration 016)

- When organising a match set the **number of sheets** and **shots per sheet** (default 6 × 10 = 60 shots, maximum 654).
- In **Manage match → Add score** enter one score per sheet (leave a sheet empty until it has been shot). The total is calculated automatically, and an optional **Lane / target no.** can be set.
- A shooter always sees their own score per sheet and total, live. Their **position** appears only when *Shooters can see their position* is ON.
- Set the match to **Completed**, then switch on **Publish full results** so registered shooters can open **View full results** (every shooter's position and sheet scores, with their own row highlighted).
- The welcome card in the shooter portal now shows the member's **QR code** (tap to enlarge for the front desk). It only displays the QR already saved on that device, and never issues a new one by itself.


## Matches: results for every shooter (migration 022)
Run `npm run db:setup` to apply `022_public_match_results.sql`. Once a completed match is marked *results published*, every shooter (including new members or anyone who did not register) sees the podium, full standings and team standings, and the real participant count. The Matches tab now has Upcoming / Completed / All filters, collapsed match cards and a *Show more* list so it stays short as matches pile up.

## Tap-to-open notifications and live matches
Tapping a notification (in the Alerts list, or the push on the lock screen) now opens the screen it is about: scores, fees, the exact match (opened and highlighted), approvals, shooters or payments for admins. For family logins it also switches to the right child. Matches the admin sets to *live* are pinned to the top of the Matches tab with a red LIVE NOW banner. **Redeploy the `push-notify` edge function** (`supabase functions deploy push-notify`) so lock-screen pushes carry the deep link.

## Google Sheets backup (migration 023)
Every addition and change (shooters, check-ins, scores, fees, matches, registrations, rifles, leave requests) is copied to a Google Sheet automatically.

1. Apply the database update: `npm run db:setup` (adds migration `023_google_sheets_backup.sql`). It needs the **pg_net** and **pg_cron** extensions (Supabase -> Database -> Extensions, both are free).
2. Sign in as an admin and open **Backup** in the sidebar. Follow the 4 steps on that page: create a private Google Sheet, paste the Apps Script (a *Copy script* button is provided; the file is also in `web/src/assets/backup-receiver.gs`), deploy it as a Web app, then paste the URL and secret.
3. Press **Connect and back up everything**. Existing data is copied first, then every change follows within about a minute.

How it works: a database trigger writes each change to a queue in the same transaction (so nothing is missed), a job sends the queue to the Google Sheet every minute and retries if Google is unreachable, and a full copy re-runs every Monday as a safety net. The sheet gets one tab per area plus a **Change Log** tab (one line per addition / edit / deletion). Deleted records are kept and marked in `_deleted_at`. Passwords and QR codes are never copied. Keep the sheet private: it contains member details.


## Professional brand refresh

The web app now uses the supplied AADI maroon-and-gold logo set and a matching brand theme. Logo assets are in `web/public/`; the visual override is `web/src/brand-refresh.css`, imported after the existing styles. Existing React routes, Supabase integration, and features were retained.

## Shooter account activation, password recovery and profile photos (Migrations 024–025)

After deploying this update, ensure migrations 001–024 are applied, then run `supabase/migrations/025_shooter_avatar_storage_rls.sql` in the Supabase SQL Editor. Migration 025 fixes profile-photo Storage permissions for individual and family accounts.

### First-time shooter login

1. In the Admin workspace, open **Shooters → Register shooter** and enter the shooter's email address. The email is required because it is the sign-in identity.
2. Share that exact email address with the shooter.
3. On the sign-in page, the shooter chooses **Create account**, enters the same email and creates a password (at least 8 characters).
4. If email confirmation is enabled in Supabase, they confirm the email from their inbox and then sign in. Their pre-registered shooter profile is automatically linked to the new login. If the email already belongs to an AADI login, the new shooter record is attached to that existing family login.

### Forgot password

The sign-in page now includes **Forgot password?**. In Supabase Dashboard → Authentication → URL Configuration, add your deployed site's `/reset-password` URL to the Redirect URLs allow-list (and the local development URL, for example `http://localhost:5173/reset-password`). Ensure the Supabase email provider is configured to send password recovery emails.

### Optional profile photo

Shooters can select the camera icon on their member profile and upload a JPG, PNG or WEBP image up to 5 MB. The image is optional. Migrations 024–025 create the `shooter-avatars` public image bucket and restrict uploads/changes to the linked shooter profile or an academy admin. Storage paths use the shooter record ID, so family accounts can upload a separate photo for each linked member. The admin Shooters directory displays the uploaded photo beside the member's name.

### Archive and delete

Admins can archive an active approved shooter directly from the Shooters directory. Archiving is blocked while the shooter has an open attendance session; the QR is deactivated and the shooter's history is retained in **Past Shooters**. Admins can restore an archived shooter. Permanent deletion remains a separate, irreversible action available only from Past Shooters and removes linked academy records.

### Important deployment notes

- Apply migration 025 after migration 024, then deploy the updated `web` application.
- Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured as before. Never expose the Supabase service-role key in the frontend.
- Password recovery emails depend on your Supabase Auth email/SMTP configuration and the Redirect URLs allow-list.

### Profile photo RPC signature fix

If photo saving reports `Could not find the function public.update_my_shooter_photo(p_avatar_url, p_shooter_id) in the schema cache`, run `supabase/migrations/026_fix_shooter_photo_rpc_signature.sql` in Supabase SQL Editor. This recreates the RPC with the named arguments expected by the frontend and reloads the PostgREST schema cache.

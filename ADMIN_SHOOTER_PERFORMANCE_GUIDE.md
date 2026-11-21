# Admin Shooter Performance Dashboard

The Shooters page now includes a **Performance** action for approved members. Select a shooter to open their 360° profile.

## Information shown

- Membership and approval status, discipline, membership ID and join date
- Total attendance sessions, visits this month, completed sessions and currently open sessions
- Average shooting score as a percentage, score history and rank among active shooters with recorded scores
- Player comparison based on average score percentage (only shooters with score records are ranked)
- Total fees paid, outstanding fees, overdue fees and recent fee history

## Data and calculation notes

- Attendance totals are based on rows in `public.attendance` for the selected shooter.
- The monthly visit count uses the current calendar month in the browser's local timezone.
- Average score percentage is the arithmetic mean of each score record's `score / max_score * 100`. It is not a weighted aggregate across shots.
- Player comparison uses the same calculation and includes approved, active shooters who have recorded scores. The panel displays the top six; the selected shooter's rank is calculated across all returned active-shooter score records.
- Fees marked `paid` are counted as paid. Other fee records are counted as outstanding; outstanding amounts past their due date are shown as overdue.
- This is a read-only overview. Use the existing Attendance, Scores and Fees & Payments pages to create or correct records.

## Setup

No new database migration is required for this UI enhancement. It reads the existing `attendance`, `shooting_scores`, `fees` and `shooters` tables. The signed-in admin must already have the existing admin read permissions/RLS policies for those tables.

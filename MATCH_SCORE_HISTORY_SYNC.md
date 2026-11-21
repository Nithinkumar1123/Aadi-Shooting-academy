# Match results appear in Shooting Scores

When an admin saves or edits a shooter's result in **Matches**, the result is automatically mirrored into the shooter's normal **Shooting Scores** history. The history uses the match date, match name, match score and match maximum score, so the result contributes to the shooter's average, trend and admin performance profile.

- Each match result creates one linked score-history entry; editing a result updates that same entry rather than duplicating it.
- Deleting a match result removes its linked history entry.
- Existing practice scores remain unchanged.
- Existing match results are backfilled when the migration is applied.
- Sighting shots are not included in the match total, consistent with the match scoring screen.

## Setup

Apply `supabase/migrations/027_sync_match_results_to_shooting_scores.sql` in the Supabase SQL Editor after the existing match and score migrations (004 and 015–020). No frontend changes are required for the synchronization: the current Shooter Scores page, shooter portal and admin performance profile already read from `shooting_scores`.

The migration uses a database trigger, so score history remains synchronized whether a match score is created or edited through the current app or another authorized admin workflow. It does not grant broader client access or disable RLS.

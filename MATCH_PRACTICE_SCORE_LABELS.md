# Practice and Match score labels

Competition results are synchronised into `public.shooting_scores` by migration `027_sync_match_results_to_shooting_scores.sql`.

- Rows with `match_id IS NOT NULL` are official Match results.
- Rows with `match_id IS NULL` are Practice/session scores.
- The admin Shooting Scores page and shooter score history now show a clear Match or Practice label.
- The admin score summary also shows the count of practice scores and match results.

Apply migrations in order through `027_sync_match_results_to_shooting_scores.sql` if they have not already been applied. Do not remove `match_id`; it is the source-of-truth distinction between a competition result and a practice score.

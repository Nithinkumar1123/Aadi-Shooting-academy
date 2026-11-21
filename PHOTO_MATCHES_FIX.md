# AADI profile photo and match-list update

## Required Supabase step

The profile-photo save RPC has been corrected to take the exact shooter/member ID. In Supabase SQL Editor, rerun the complete file:

`supabase/migrations/024_shooter_access_profiles.sql`

This migration is safe to rerun: it replaces the photo RPC, refreshes the avatar storage bucket policies, and keeps the other 024 setup in place. Do not skip this step; the frontend and database function signatures must match.

## Profile photo flow

- Shooter chooses a JPG, PNG, or WEBP image (up to 5 MB).
- Image is uploaded to the `shooter-avatars` bucket under that authenticated account.
- The exact selected member's `shooters.avatar_url` is updated through `update_my_shooter_photo(p_shooter_id, p_avatar_url)`.
- The page updates immediately and adds a cache-busting query to the displayed image.
- Admin shooter list reads `avatar_url` and displays the image when present.

## Match list improvements

- Search by match name, discipline, venue, or description.
- Filters: All matches, Upcoming, My registrations, Completed.
- Upcoming and past matches are grouped separately; past matches sort newest first.
- Six matches are shown at a time with a Show 6 more matches control.
- Search and filter changes reset the visible list.

## Run locally

```bash
cd web
npm install
npm run dev
```

After deployment, test with a non-admin shooter account and verify that the profile image also appears in the admin Shooters page. Test a family account by switching members and uploading a different photo to each member.

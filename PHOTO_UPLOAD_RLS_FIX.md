# AADI Shooter Profile Photo – RLS and RPC Fix

## Required Supabase steps

Apply the SQL migrations in order if they have not already been applied:

1. `supabase/migrations/024_shooter_access_profiles.sql`
2. `supabase/migrations/025_shooter_avatar_storage_rls.sql`
3. `supabase/migrations/026_fix_shooter_photo_rpc_signature.sql`

If migrations 024 and 025 were already applied, run only the complete contents of migration 026 in Supabase **SQL Editor**.

Migration 026 recreates `public.update_my_shooter_photo` with the exact named arguments expected by the web client (`p_avatar_url`, `p_shooter_id`), grants execution only to authenticated users, checks that the selected shooter row belongs to the signed-in family account, and requests a PostgREST schema-cache reload.

Do not disable RLS or expose the Supabase service-role key in browser code.

## Test

1. Sign in as a shooter and upload a JPG, PNG or WEBP photo under 5 MB.
2. Confirm the success message appears, then refresh the shooter portal.
3. Open the admin Shooters directory and confirm the same photo is visible.
4. Switch to another family member and confirm each member's photo remains separate.

# Family switcher profile photos

The family member switcher and the "Who's training today?" picker now display each shooter's `avatar_url` photo. The same shared `Avatar` component is used in both places, so the uploaded image appears consistently when switching members and when choosing a member.

If a member has no photo, or the image cannot load, the UI falls back to their initials and the member's stable colour. No database migration is required. Photos are read from the existing `shooters.avatar_url` field.

# Phase 6 account security

## Environment configuration
Password reset email requires all three variables:
- `RESEND_API_KEY`: server-only Resend API key.
- `AUTH_EMAIL_FROM`: verified sender identity configured in Resend.
- `NEXT_PUBLIC_APP_URL`: canonical HTTPS TopMint origin, e.g. the deployed site origin.

Without these settings, the forgot-password endpoint deliberately returns a generic response and does not create a reset token or claim an email was sent. Never expose the Resend key through a `NEXT_PUBLIC_` variable.

## Database migration
This phase adds nullable `User.emailVerifiedAt`, nullable `User.passwordChangedAt`, `User.sessionVersion` defaulting to zero, and `PasswordResetToken`. Existing users and financial records are preserved. Deploy with the existing release process after reviewing the migration; do not reset the database.

## Known security limitations
Email verification is not enabled in this change because the existing product does not yet have a verified-email delivery and token lifecycle. The new nullable field only reports verified when a future supported flow sets it. Customer logout clears the browser cookie; already copied stateless JWTs are not centrally revoked by logout. Password reset increments `sessionVersion`, but session-version enforcement in the existing JWT verification middleware must be completed before claiming global revocation. Admin/customer JWT secrets and cookies remain separate.

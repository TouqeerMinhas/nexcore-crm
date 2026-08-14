# NexCore CRM v8 — Caller/Admin Password Reset

This version adds a secure caller or admin password-reset flow.

## Password reset flow

1. Caller/Admin clicks **Forgot password?** on the login screen.
2. Caller/Admin enters the same email address used by the admin when the caller or admin account was created.
3. NexCore sends a **6-digit one-time code** to that email address.
4. The code expires after **10 minutes**.
5. After up to **5 invalid code attempts**, the caller or admin must request a new code.
6. Caller/Admin sets a new password and can sign in normally.

Only accounts with `role: caller or admin` can use this reset flow.

## SMTP setup

Real email delivery requires SMTP configuration. Copy `.env.example` values into your environment. The app reads these variables directly from Node.js environment variables; no credentials are hard-coded.

Required variables:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`

Optional:

- `SMTP_FROM` — sender address. Defaults to `SMTP_USER`.
- `SESSION_SECRET`
- `DIALER_WEBHOOK_TOKEN`

Use the SMTP server/port/security settings provided by your email provider. For a business mailbox, use the provider's SMTP password/credentials rather than the CRM caller or admin's password.

## Windows PowerShell example

```powershell
$env:SMTP_HOST="smtp.example.com"
$env:SMTP_PORT="465"
$env:SMTP_SECURE="true"
$env:SMTP_USER="your-email@example.com"
$env:SMTP_PASS="your-email-password"
$env:SMTP_FROM="your-email@example.com"

npm install
npm start
```

These values apply only to the current PowerShell session. For permanent Windows environment variables, set them through Windows Environment Variables.

## Existing CRM data

Keep the existing `data` folder when replacing the application files. The database automatically adds a `passwordResets` collection if it is missing.

## Dependencies

A new dependency is required:

```text
nodemailer
```

Run `npm install` after replacing the files.

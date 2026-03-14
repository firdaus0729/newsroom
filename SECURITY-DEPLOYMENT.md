# Security and deployment notes

## HTTPS (SSL)

- **Production**: Serve the site over **HTTPS** only. Use Let's Encrypt (e.g. Certbot) and Nginx to terminate SSL.
- **Reporter login/session**: JWT tokens are stored in `localStorage`. Ensure:
  - The site is only loaded over HTTPS so tokens are not sent over plain HTTP.
  - Nginx (or your reverse proxy) sets `Strict-Transport-Security` and redirects HTTP → HTTPS.
- **Cookies**: If you switch to httpOnly cookies for sessions in the future, set `Secure` and `SameSite` for production.

## Upload limit (300 MB)

- **Backend**: `UPLOAD_MAX_SIZE_MB=300` in `.env` (default 300). Multer and validation enforce this.
- **Nginx**: Set `client_max_body_size 300M;` in the `location /api/` block so large uploads are not rejected by the proxy.

## Administrator credentials

- Set in backend `.env`:
  - `ADMIN_EMAIL` – admin login email
  - `ADMIN_PASSWORD` – admin password (or use `ADMIN_PASSWORD_HASH` with a bcrypt hash)
- Admin panel: `https://your-domain/admin` (login at `/admin/login`).
- Only admins can add reporters (admin panel) and add/remove editors (Newsroom “Add editor” is admin-only).

## Role-based access

- **Admin**: Full access; can add reporters and editors; can stop any stream.
- **Editor**: Can view reporters, live streams, uploads, activity; can stop streams; **cannot** add or remove editors or reporters.

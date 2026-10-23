# Connect PotsHavenGh to Supabase on Vercel

The app now includes its Vercel backend. It needs a durable database and private sign-in passwords before the company workspace can open. A Supabase API URL or public/anon key alone is not a database connection.

For the existing company workspace, open [potshaven-ekl2.vercel.app](https://potshaven-ekl2.vercel.app/). `potshaven.vercel.app` is a different deployment address; settings saved in one Vercel project do not configure another. This repository redirects the shorter address's root to the configured workspace when deployed there. If an older deployment still shows setup, use the configured address directly.

1. Open [Supabase](https://supabase.com/dashboard), create a project named `PotsHavenGh`, and keep its database password privately. You can also use an existing project you own.
2. In the project, choose **Connect → Transaction pooler** and copy the PostgreSQL connection string. Use the pooler hostname and port **6543**, insert your database password into the string, and URL-encode special password characters if needed. Do not paste this secret into chat or a repository file.
3. Open the `potshaven-ekl2` project in **Vercel → Settings → Environment Variables**. Add these server-only variables for the environments you use:

   | Name | Private value |
   | --- | --- |
   | `DATABASE_URL` | The Supabase Transaction Pooler PostgreSQL connection string |
   | `APP_OWNER_PASSWORD` | A strong password for the business owner |
   | `APP_MANAGER_PASSWORD` | A different strong password for the manager |

   `SUPABASE_DB_URL` or `POSTGRES_URL` are also accepted aliases for `DATABASE_URL`. Do not use a `VITE_` or `NEXT_PUBLIC_` prefix for these secrets.
4. In Vercel **Deployments**, redeploy the latest commit so the function receives the new settings. The app initializes its database tables automatically on first connection, then shows sign-in. Use role **Business owner** or **Manager** and its corresponding private password.
5. Add the company’s places, crew, stock, and jobs. The hosted database starts empty, with the PotsHavenGh logo and “Brighten your world” branding. The development demo database is never copied to Vercel.

Image generation is optional. Add `POTSHAVEN_OPENAI_KEY` privately in Vercel and redeploy to enable it. The default is `gpt-image-2.5-sunburst` at `max` quality; generated images are saved as JPEG95. A ChatGPT subscription does not supply API billing or a key. Vercel function duration is set to 300 seconds; unusually slow generations may time out at the hosting limit.

## What the integration stores

- Company records, stock history, uploaded photos, generated designs, and the session signing secret persist in Supabase PostgreSQL.
- The tables and functions live in `potshaven_private`, with public schema/function privileges revoked. No Supabase public/anon key or service-role key is sent to the browser.
- Stock deductions and recurring follow-ups run atomically in the database. Session cookies remain valid across function cold starts and expire when passwords change.
- Photos load from authenticated media routes with private caching; they are not embedded in every workspace response.
- TLS certificate and hostname verification remain enabled. The backend includes Supabase's official production database CA certificates, so Vercel can verify the database connection without another environment variable. Supabase’s Transaction Pooler is used with prepared statements disabled and a small connection pool for serverless execution.

## If setup still does not open

Check that the Supabase project is active, the connection string uses the Transaction Pooler (not the HTTPS project URL), the database password is correct, all three private variables are set in the appropriate Vercel environment, and the latest deployment was redeployed after changes. The app shows setup guidance for missing configuration and reconnects automatically for temporary interruptions.

The backend also repairs company settings saved in the legacy double-encoded format. This happens automatically after deployment, preserves a private backup, and does not clear company records or reset passwords. `/api/health` verifies real database reads instead of reporting only that the server started. Temporary connection failures retry a read once, and unsuccessful cloud startup releases its pool before reconnecting. Saves and stock deductions are never automatically repeated.

This repository includes tests against an embedded PostgreSQL engine and the Vercel handler. The deployed site's public health endpoint can verify a current database read, but it does not establish that authenticated workflows, provider account settings, backups, or paid image generation have been checked. Reviewing Supabase/Vercel account configuration requires authorized access to those accounts.

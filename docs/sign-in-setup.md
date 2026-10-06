# Sign-in: one-time setup

Anyone can create an account, with **Google** or **email + password**, and must sign in to see the
signals and chat. The admin can block people on the site's **Members** page. All free.

Do the steps in order. `<site>` below means your Vercel address, e.g. `https://golden-skibidi.vercel.app`.

## 1. Google Cloud: create the sign-in keys

1. Open https://console.cloud.google.com and sign in with your Google account.
2. Top bar → project picker → **New project** → name `Gold Lab` → **Create**, then select it.
3. Menu → **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**) →
   **Get started**:
   - App name `Gold Lab`, support email: yours → Next
   - Audience: **External** → Next
   - Contact email: yours → Next → agree → **Create**
4. **Audience** (left menu) → **Publish app** → Confirm. (Otherwise only test users can sign in.
   Basic sign-in with email and profile doesn't need Google's review.)
5. **Clients** (left menu) → **Create client**:
   - Application type: **Web application**, name `Gold Lab`
   - **Authorized JavaScript origins**: `<site>` and `http://localhost:3000`
   - **Authorized redirect URIs**: `https://<your-project>.supabase.co/auth/v1/callback`
     (copy the exact one from step 2.3 below)
   - **Create**, then copy the **Client ID** and **Client secret** (keep the secret private).

## 2. Supabase: turn on Google

1. Supabase → your project → **Authentication → Sign In / Providers → Google** → enable.
2. Paste the **Client ID** and **Client secret** from step 1.5 → **Save**.
3. The same page shows the **Callback URL** (`https://<your-project>.supabase.co/auth/v1/callback`):
   that's the one for step 1.5's redirect URI.
4. **Authentication → URL Configuration**:
   - **Site URL**: `<site>`
   - **Redirect URLs** → Add: `<site>/auth/callback` and `http://localhost:3000/auth/callback`

## 3. Supabase: email + password accounts

1. **Authentication → Sign In / Providers → Email**: enabled, **Confirm email** on (so nobody can
   register with someone else's address) → Save.
2. Supabase's built-in email only sends a few emails an hour (confirmations and password resets).
   For more, add a free email service: **Authentication → Emails → SMTP Settings** with e.g. Resend
   or Brevo (both have free plans). Fine to skip while only a few people sign up.

## 4. Vercel: check the settings

Project → Settings → Environment Variables should have:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already there)
- `SUPABASE_SECRET_KEY` (already there for chat; sign-in needs it too)

Delete `SITE_PASSWORD` - it isn't used any more. Then **Deployments → Redeploy**.

## 5. Supabase: accounts and the admin

1. Open `supabase/members.sql`, replace `YOUR-EMAIL@gmail.com` with the email you'll sign in with
   (you become the admin).
2. Supabase → **SQL Editor → New query** → paste → **Run**.

From now on only signed-in accounts can read signals and chat.

## 6. Try it

1. Open `<site>` → **Continue with Google** (or **Create an account** with email) → choose your
   display name.
2. Header → **Members** lists everyone who has signed up. **Block** signs someone out within 30
   seconds and keeps them out; **Unblock** lets them back.

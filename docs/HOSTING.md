# Putting Trusic online for free

This puts a public demo of Trusic on [Render](https://render.com)'s free plan. It costs nothing and needs no
card. You get a web address like `https://trusic-abcd.onrender.com` that anyone can open, on a computer or a phone.

What the demo is, and isn't:

- **Anyone can browse** and hear 30-second previews. **Only people you give the demo password to can log in.**
  Sign-ups are closed so strangers can't fill it with uploads.
- **It resets, unless you keep its data.** The free plan has no permanent disk, so every time the site restarts it
  starts again from the demo data. Anything people upload, like or pay disappears. The demo data is made when the
  site is built, so its months are the ones around the last update. To keep everything instead, add a free Supabase
  project: see [Keep your data (free)](#keep-your-data-free).
- **It sleeps.** After 15 minutes with no visitors it goes to sleep, and the next visitor waits about a minute while
  it wakes up. After that it's quick.
- **Payments are pretend** (demo billing) unless you add Stripe test keys. See below.

## Steps (about 10 minutes)

1. Go to [render.com](https://render.com) and click **Get Started**. Choose **Sign up with GitHub**, and use the
   GitHub account that owns the Trusic repository.
2. If Render asks which plan you want, choose **Hobby** (free). **If it asks for a card, stop.** You don't need one
   for this, and without a card Render can't charge you.
3. In the Render dashboard, click **New** → **Blueprint**.
4. Connect GitHub if asked, and give Render access to the **trusic** repository (you can allow just that one).
5. Pick the **trusic** repository, and choose the branch **`claude/trusic-ai-music-platform-0n6c42`** (or `main`,
   once the work is merged there).
6. Render reads `render.yaml` from the repository and shows one service, **trusic**, on the **Free** plan. Give the
   blueprint any name and click **Deploy Blueprint** (the button may say **Apply**).
7. Wait for the first build. It takes 5–10 minutes. When the service shows **Live**, click its address at the top of
   the page.

### Logging in

The demo accounts are the same as on your own computer:

| Email                   | What to look at                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| `listener@trusic.local` | A Premium listener. **Your money** shows where their money went. |
| `pines@trusic.local`    | The Hollow Pines, a human band. **Studio** shows earnings.       |
| `prompter@trusic.local` | An AI act, with a track flagged by detection and under appeal.   |
| `admin@trusic.local`    | **Admin**: appeals, strikes and monthly payouts.                 |

The password isn't `trusic-demo` here. Render made up a random one. To find it, open the **trusic** service in
Render → **Environment** → **DEMO_PASSWORD**, and click the eye icon to show it. That's the password for all four
accounts. Share it only with people you want to let in.

### Updating it

Render rebuilds the site whenever new work is pushed to the branch you chose. You don't need to do anything.

### Using it from the desktop and phone apps

- **Desktop app:** open **Server…** (in the Trusic menu on a Mac, the File menu on Windows and Linux), paste your
  site's address, e.g. `https://trusic-abcd.onrender.com`, and click **Save and reload**.
- **Phone app (Expo Go):** put `EXPO_PUBLIC_API_URL=https://trusic-abcd.onrender.com/api` in `apps/mobile/.env`
  and start it with `pnpm mobile`. See [apps/mobile/README.md](../apps/mobile/README.md).

If the site is asleep, the first screen takes about a minute to load.

## Limits on the free plan

- **5 GB of downloads a month.** Music is sent at 160 kbps, about 1.2 MB a minute, so that's roughly 1,000 plays of
  a four-minute track, or 8,000 previews. If the limit is reached, Render pauses the site until the next month.
  Without a card on file, it **can't** charge you for more.
- **512 MB of memory.** Trusic uses about 300 MB, and under 400 MB while it converts an upload.
- **A tenth of a computer's processor.** New uploads are converted for streaming (an even volume, and a much smaller
  file) one at a time in the background, which takes a minute or two for a four-minute track. Until then only the
  artist can see the track, marked **Processing** in Studio.
- **750 hours a month**, which is enough to run one site all month. Hours aren't used while it's asleep.

## Keep your data (free)

Out of the box the demo forgets everything when it restarts. To keep uploads, accounts, likes, plays and payouts,
give it a free [Supabase](https://supabase.com) project: a database and file storage that last. It takes about 15
minutes and needs no card. Without it, nothing changes: the demo resets as before.

### What Supabase's free plan gives you

Checked on 21 October 2026 (plans change, so look at [supabase.com/pricing](https://supabase.com/pricing) too):

- **500 MB database.** Plenty for a demo.
- **1 GB of file storage.** Trusic keeps each upload as it arrived, plus the copy it streams and a 30-second
  preview. A four-minute WAV takes about 45 MB in all; an MP3 or FLAC far less. The demo data takes about 45 MB.
- **Files up to 50 MB each.** That's about five minutes of WAV. For longer tracks, upload FLAC (the same quality at
  about half the size) or MP3. Step 11 sets Trusic's own limit to match, so the site says so before uploading.
- **5 GB of downloads a month**, shared with database use. Music passes through both Supabase and Render, so in
  practice it's the same limit as Render's.
- **Two active projects** at a time.
- **It pauses after a week without use.** If nobody uses the site for seven days, Supabase pauses the project and
  emails you. Your data is kept, but the Trusic site won't start while it's paused. To wake it, open the project in
  Supabase and click **Restore project**, wait a few minutes, then open the site. Visiting the site once a week
  avoids this.

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and click **Start your project**. Choose **Continue with GitHub** and
   allow access.
2. If it asks you to create an organisation, give it any name, choose **Personal** and the **Free** plan, and click
   **Create organization**.
3. Click **New project**. Call it `trusic`. Next to **Database password**, click **Generate a password**, then copy
   it and keep it somewhere safe, such as your password manager: you need it in step 6. For **Region**, choose
   **West EU (London)** (it may be listed under Europe). Click **Create new project**, and wait a couple of minutes
   while it's set up.

### 2. Copy the database's address

4. Click **Connect** at the top of the project's page.
5. Under **Connection string**, find **Session pooler** and copy its address. (Not **Direct connection**: Render
   can't reach that one.) It looks like
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`.
6. Paste it somewhere for a moment, and replace `[YOUR-PASSWORD]`, square brackets included, with the password from
   step 3. The whole line is your `DATABASE_URL`.

### 3. Make a storage bucket and its keys

7. In the menu on the left, click **Storage**, then **New bucket**. Call it `trusic`, leave **Public bucket** off,
   and click **Create bucket**. (Trusic sends the files to listeners itself, so the bucket stays private.)
8. Still in **Storage**, open **Settings** (on some screens it's **Project Settings** → **Storage**). Under **S3
   Connection**, check that **Connection via S3 protocol** is on, then copy the **Endpoint** (it ends in
   `/storage/v1/s3`) and the **Region** (`eu-west-2` for London).
9. Under **S3 Access Keys**, click **New access key**, call it `Render`, and create it. Copy the **Access key ID**
   and the **Secret access key** straight away: Supabase only shows the secret once. Treat it like a password, as it
   opens all your files.

### 4. Give the settings to Render

10. In Render, open the **trusic** service and click **Environment**.
11. Add each of these with **Add Environment Variable**. The names must be exactly as shown.

    | Key                    | Value                                           |
    | ---------------------- | ----------------------------------------------- |
    | `DATABASE_URL`         | The address from step 6                         |
    | `S3_ENDPOINT`          | The endpoint from step 8                        |
    | `S3_REGION`            | The region from step 8, e.g. `eu-west-2`        |
    | `S3_BUCKET`            | `trusic`                                        |
    | `S3_ACCESS_KEY_ID`     | The access key ID from step 9                   |
    | `S3_SECRET_ACCESS_KEY` | The secret access key from step 9               |
    | `MAX_UPLOAD_MB`        | `50`, Supabase's limit for one file (see above) |

12. Click **Save, rebuild, and deploy** (it may say **Save changes**).

### What happens next

- **The first start loads the demo data into Supabase, once.** The site opens straight away, but filling it takes
  about FIRST_BOOT, because converting the demo audio is slow on the free plan. The **Logs** tab says
  `Done. Log in with…` when it's finished. The demo accounts' password is still the one in **DEMO_PASSWORD**.
- **From then on, everything is kept** through restarts, sleeps and updates. The demo data is never loaded again,
  because the database isn't empty.
- **To check:** like a track or upload one, then restart the site (in Render, **Manual Deploy** → **Restart
  service**), or let it go to sleep and open it again. It should still be there.

If something isn't right, the **Logs** tab says what. The usual ones:

- `Can't store files in the "trusic" bucket…`: check the five `S3_` settings, and that the bucket's name matches.
- `password authentication failed`: the password in `DATABASE_URL` is wrong. You can set a new one in Supabase under
  **Project Settings** → **Database** → **Reset database password**, then put it in `DATABASE_URL`.
- `ENETUNREACH`, or a long wait and then a timeout: that's the **Direct connection** address. Use **Session pooler**.
- The site won't start after a quiet week: Supabase has paused the project. Restore it (see above).

To start again from the demo data, delete the Supabase project (**Project Settings** → **General** → **Delete
project**), make a new one, and repeat the steps. To go back to the resetting demo, delete the settings from step 11.

Sources for Supabase's limits, checked by web search on 21 October 2026 (supabase.com itself couldn't be opened from
where this was written, so check them there): [pricing](https://supabase.com/pricing),
[file size limits](https://supabase.com/docs/guides/storage/uploads/file-limits),
[project pausing](https://supabase.com/docs/guides/platform/free-project-pausing),
[billing and egress](https://supabase.com/docs/guides/platform/billing-on-supabase),
[connecting from IPv4-only hosts such as Render](https://supabase.com/docs/guides/database/connecting-to-postgres)
and [S3 access keys](https://supabase.com/docs/guides/storage/s3/authentication).

## Optional: try real Stripe checkout (still free)

Out of the box, **Subscribe** works instantly with pretend money. To see Stripe's real checkout page using test
cards (no real money), follow [STRIPE.md](STRIPE.md) to get test keys, then add these in Render under
**Environment**:

| Key                     | Value                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Your `sk_test_…` key                                             |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_…` secret for a webhook pointing at your site (below) |
| `PUBLIC_URL`            | Your site's address, e.g. `https://trusic-abcd.onrender.com`     |

The webhook address is your site's address followed by `/api/billing/webhook`.

## Optional: send real emails (still free)

Out of the box the site doesn't send emails. Password-reset links, email confirmations and takedown notices are
printed in the **Logs** tab of the **trusic** service instead (search for `Email (printed here`). The demo accounts
count as already confirmed, so they can upload straight away.

To send real emails, follow [EMAIL.md](EMAIL.md): Brevo's free plan sends 300 a day, with no card needed. Add its
settings under **Environment**.

## Sharing links and embedding players

Links to tracks, releases, artists and public playlists show a proper preview (a picture with the title, artist
and AI label) when they're pasted into WhatsApp, iMessage, Slack, Discord and the like, and bands can put a player
on their own website from the **Share** menu. There's nothing to set up: Render tells Trusic its own address. If
you later give the site its own domain name, set `PUBLIC_URL` to it under **Environment**, so previews and embed
codes use that address.

Because the free site sleeps, the first preview after a quiet spell can take about a minute to load, and some apps
give up and show a plain link. Pasting the link again a minute later works.

## When it's time for a real launch

The free setup is for trying Trusic out. Even with Supabase it pauses after a quiet week, has no backups you can
restore, and takes files only up to 50 MB; and Render's free server sleeps and has a tenth of a processor. A real
launch needs paid plans for all of these. They cost money, so they're left until you're ready. The "Before launch"
list in [ROADMAP.md](ROADMAP.md) covers what else is needed.

## Running the same container yourself

The site is one Docker image: the API serves the web app from the same address.

```sh
docker build -t trusic .
docker run -p 10000:10000 -e DEMO_SEED=true -e STREAM_SIGNING_SECRET=$(openssl rand -hex 32) trusic
```

Then open http://localhost:10000. Without `DEMO_PASSWORD` the password is `trusic-demo`. Add `-e REGISTRATION=closed`
to turn off sign-ups, and `-v trusic-data:/data` to keep data between restarts. Or keep it elsewhere with the same
settings as above (`-e DATABASE_URL=…`, `-e S3_ENDPOINT=…` and so on): any Postgres works, and any S3-compatible
storage, such as Cloudflare R2, Backblaze B2 or MinIO.

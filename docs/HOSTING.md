# Putting Trusic online for free

This puts a public demo of Trusic on [Render](https://render.com)'s free plan. It costs nothing and needs no
card. You get a web address like `https://trusic-abcd.onrender.com` that anyone can open, on a computer or a phone.

What the demo is, and isn't:

- **Anyone can browse** and hear 30-second previews. **Only people you give the demo password to can log in.**
  Sign-ups are closed so strangers can't fill it with uploads.
- **It's a demo: it resets.** The free plan has no permanent disk, so every time the site restarts it starts again
  from the demo data. Anything people upload, like or pay disappears. The demo data is made when the site is
  built, so its months are the ones around the last update.
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

## Limits on the free plan

- **5 GB of downloads a month.** A demo track is about 2 MB, so that's a couple of thousand plays. If the limit is
  reached, Render pauses the site until the next month. Without a card on file, it **can't** charge you for more.
- **512 MB of memory.** Trusic uses about 350 MB.
- **750 hours a month**, which is enough to run one site all month. Hours aren't used while it's asleep.

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

## When it's time for a real launch

The demo setup throws data away by design. A real launch needs a database that keeps data (set `DATABASE_URL`),
file storage for audio and artwork that survives restarts, and a paid server that doesn't sleep. Those cost money,
so they're left until you're ready. The "Before launch" list in [ROADMAP.md](ROADMAP.md) covers what else is
needed.

## Running the same container yourself

The site is one Docker image: the API serves the web app from the same address.

```sh
docker build -t trusic .
docker run -p 10000:10000 -e DEMO_SEED=true -e STREAM_SIGNING_SECRET=$(openssl rand -hex 32) trusic
```

Then open http://localhost:10000. Without `DEMO_PASSWORD` the password is `trusic-demo`. Add `-e REGISTRATION=closed`
to turn off sign-ups, and `-v trusic-data:/data` to keep data between restarts.

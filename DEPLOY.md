# Deploying: Render (web server + WebSockets) + Neon (Postgres)

## Database (Neon): already done
The tables (`threads`, `replies`, `images`, `posters`) were created in your Neon database with `npm run db:setup`.
The server also creates any missing tables itself every time it starts, so a fresh database just works.

## Web server (Render)
1. Push this repo to GitHub (already done).
2. Render dashboard → **New** → **Blueprint** → connect GitHub and pick `ForumWebsiteNew`.
   Render reads `render.yaml` and sets up a free Node web service called `hotel3d`.
   - **Without the Blueprint:** **New → Web Service** → pick the repo → Runtime **Node**, Build command `npm ci`, Start command `npm start`, Instance type **Free**.
3. When Render asks for **`DATABASE_URL`**, paste the `DATABASE_URL` value from your `.env` (the Neon connection string).
   You can also add it later under the service's **Environment** tab.
4. Deploy. When it's live, open `https://<your-service>.onrender.com`. Under the Enter button there should be **no** "Demo data" note, and the top-right should show **"1 online"**.

After that, every `git push` to `main` redeploys automatically.

## Free-tier things to know about

**Render (free web service)**
- **It goes to sleep after 15 minutes with no visitors.** The next visitor waits **~30–60 seconds** while it wakes up (the page shows "Loading…" until it's up). WebSockets are disconnected when it sleeps, and the game reconnects automatically.
- **750 free instance hours per month.** That's enough for one service running all month, but not two.
- **The disk is wiped on every deploy/restart.** That's why uploaded images are stored in the database instead of as files.
- **Everything runs as one server instance.** Multiplayer works because everyone connects to that one instance. That's fine at this size.

**Neon (free Postgres)**
- **0.5 GB storage per project.** Images are stored in the database, so they use it up fastest. Uploads are capped at 3 MB each (`MAX_IMAGE_BYTES` in `server/index.js`), so that's roughly 150+ big images, or many more small ones.
  - If you outgrow it, the next step is moving images to object storage (e.g. Cloudflare R2's free tier).
- **The database suspends after ~5 minutes idle.** The first query after that takes a moment longer (usually under a second). You'll mostly notice it stacked on top of Render's wake-up.
- **Compute hours per month are limited on the free plan.** A hobby forum fits easily, but check Neon's dashboard (Billing / Usage) if the site gets busy.

**Security**
- `.env` is in `.gitignore`, so your database password is **not** on GitHub. Keep it that way.
  - If it ever leaks, reset the password in the Neon dashboard (Roles → reset password) and update `DATABASE_URL` on Render and in `.env`.
- There are no accounts or moderation tools yet. To delete posts, use Neon's **SQL Editor**:
  `DELETE FROM threads WHERE thread_id = 5;` (also deletes its replies).

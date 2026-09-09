# GeoGuess LIVE — Version 1 (Worldle-style country shape game)

A TikTok LIVE game: viewers guess a country from its map silhouette by typing
in the comments. Distance + direction hints, live leaderboard, host panel —
all designed to run as your on-screen game during a **Mobile Gaming LIVE**
broadcast on a single Android phone.

---

## PART 1 — Understand the 3 pieces (30 seconds)

1. **GitHub** = where the code lives (a folder online).
2. **Render** = the "computer" that runs the code 24/7 and gives you a web link.
3. **Your phone** = opens that web link in the browser during your TikTok LIVE.

You will never write or edit code. You're just uploading files and clicking buttons.

---

## PART 2 — Upload the code to GitHub

1. Go to https://github.com and log in.
2. Click the **+** icon (top right) → **New repository**.
3. Name it `geo-guess-live` → set it to **Public** or **Private** (either is fine) → click **Create repository**.
4. On the new repo page, click **"uploading an existing file"** (a blue link in the middle of the page).
5. Drag in **every file and folder** from the project you were given (`server.js`, `package.json`, `countries.json`, `render.yaml`, `.gitignore`, `README.md`, and the whole `public` folder with `index.html`, `styles.css`, `app.js`, `manifest.json` inside it).
   - Tip: if GitHub's upload box won't accept a folder by drag-and-drop on your phone, use a computer or laptop just for this one-time upload step — after that, you'll never need one again.
6. Scroll down, click **Commit changes**.

Your code is now on GitHub. ✅

---

## PART 3 — Deploy it on Render

1. Go to https://render.com and log in.
2. Click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository** → connect your GitHub account if asked → select the `geo-guess-live` repo.
4. Render should auto-detect the settings from `render.yaml`. If it asks manually, set:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add one:
   - Key: `TIKTOK_USERNAME`
   - Value: your TikTok username **without the @**, e.g. `janedoe123`
   *(Your friend will do this same step with HER OWN username when she deploys her own copy — see Part 5.)*
6. Click **Create Web Service**. Wait 2–5 minutes for the first deploy (you'll see logs scrolling).
7. When it says **"Live"** at the top, copy your app's link — it looks like:
   `https://geo-guess-live.onrender.com`

That link is your game screen. ✅

> ⚠️ Free Render services "sleep" after 15 minutes of no traffic and take ~30-60 seconds to wake up on the next visit. Open your link 2 minutes before you plan to go live so it's already awake. If this matters a lot to you, Render's cheapest paid tier (~$7/month) keeps it always-on instantly.

---

## PART 4 — Go LIVE on TikTok (single phone, no extra device)

1. On your phone, open the link from Part 3 in your browser (Chrome recommended).
2. Wait for the world map screen to load, and wait for the top-right badge to say **"🔴 LIVE @yourname"** — this means it found your stream. (It will say "Waiting for LIVE…" until TikTok shows you as actually live — see next step.)
3. **Add it to your home screen** for a clean full-screen app-like view:
   - Chrome menu (⋮) → **Add to Home screen** → **Add**.
4. Open the **TikTok app** → tap **+** → go to **LIVE** → swipe/select the **Mobile Gaming LIVE** mode you mentioned you have access to.
5. In that mode, TikTok will ask you to select the app/screen to broadcast — choose the GeoGuess LIVE app/page you just added to your home screen (this is exactly what "Mobile Gaming" mode is built for: broadcasting a game screen with your camera bubble).
6. Start your TikTok LIVE. Within a few seconds, the badge in the game should flip to **🔴 LIVE @yourname**, and viewer comments will start driving the game automatically.
7. To guess/answer/test as the host yourself, use the **text box at the bottom** of the game screen and hit **Send** — it counts as an official host guess.
8. Buttons at the bottom: **🔄 New Round** (skip to a new country anytime), **👁 Reveal** (show the answer), and the **difficulty dropdown** (All Countries vs. Well-Known Only).

That's it — everything else (reading comments, scoring, hints, leaderboard, auto new rounds) happens automatically.

---

## PART 5 — Sharing this with your friend

Because Render needs to know *whose* TikTok LIVE to connect to, each host needs
their **own** deployed copy (this takes her ~5 minutes, following Parts 2–4 with her own GitHub/Render accounts):

1. She creates her own free GitHub + Render accounts (or uses existing ones).
2. She uploads the exact same files to her own GitHub repo (Part 2).
3. She deploys it on her own Render account (Part 3), entering **her own TikTok username** in the `TIKTOK_USERNAME` field.
4. She opens her own resulting link on her phone and follows Part 4.

No coding needed on her end either — just repeating the same click-through steps with her own account details.

---

## How the game works (for your reference)

- Each round picks a random country and shows only its **map silhouette** (no name, no borders of neighbors).
- Viewers type the country name in TikTok comments (e.g. `France`, `japan`, `!guess Brazil`).
- Each viewer gets **one guess per round**. The game replies with:
  - **Correct** → round won instantly, points awarded (more points for guessing in fewer total attempts).
  - **Wrong** → shows a **% closeness**, a **distance in km**, and a **compass arrow** pointing toward the real country — exactly like Worldle.
- After **6 total wrong guesses** with no winner, the answer is revealed automatically.
- A **new round starts automatically** ~6 seconds after a round ends.
- The **Top 10 leaderboard** tracks points across the whole stream (resets only if the server restarts, or if you add a "reset leaderboard" trigger later).

## Notes on reliability (please read)

- The TikTok comment connection uses a well-established open-source library (not an official TikTok API, since TikTok doesn't offer one publicly). It works well for the vast majority of streamers but can occasionally need a restart if TikTok changes something on their end — if the badge gets stuck on "Reconnecting," go to your Render dashboard and click **Manual Deploy → Restart**.
- Keep guesses simple (just the country name) for the smoothest recognition. The game understands common variations (e.g. "usa," "uk," "south korea").

---

## What's next (v2 ideas, once you're happy with v1)
- More games beyond Worldle (flags, capitals quiz, continent sorting).
- Persistent leaderboard across multiple streams (saved to a database).
- Sound effects and win animations.
- A "streak" bonus system.

Just tell me when you're ready and we'll build the next layer.

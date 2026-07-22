# Talysman — Beta Install Guide

Thanks for testing Talysman! This takes about 5 minutes. There are three steps:

1. Install the desktop app
2. Load the Chrome extension I sent you
3. Redeem your comp code inside the app

Do them in this order — the desktop app carries the service that does the actual
blocking, so it needs to be in place first.

---

## 1. Install the desktop app

1. Go to **[talysman.app/download](https://talysman.app/download)**.
2. The page detects your operating system — click the card that matches:
   - **Windows** — Windows 10/11, 64-bit
   - **macOS** — Apple Silicon or Intel
   - **Linux** — `.deb` (Debian/Ubuntu, x86-64)
3. Run the installer you downloaded and follow the prompts.

**If your OS shows a security warning** (we're still finishing app-store signing):

- **Windows** — SmartScreen may say "Windows protected your PC." Click **More info →
  Run anyway**.
- **macOS** — if it says the app "can't be opened," go to **System Settings → Privacy
  & Security**, scroll down, and click **Open Anyway**. (Or right-click the app →
  **Open**.)

Open Talysman once it's installed and leave it running.

---

## 2. Load the Chrome extension

I sent you a folder (the unpacked extension). The web extension is what actually blocks
sites in the browser, so this step is required — not optional.

1. Unzip the folder somewhere permanent (Documents is fine). **Don't delete or move it
   afterward** — Chrome loads the extension from that exact location every time it starts.
2. Open Chrome and go to **`chrome://extensions`** (paste it into the address bar).
3. Turn on **Developer mode** — the toggle is in the top-right corner.
4. Click **Load unpacked** (top-left).
5. Select the extension folder you unzipped and click **Select / Open**.

Talysman should now appear in your extensions list. Pin it if you like (puzzle-piece icon
in the toolbar). It pairs automatically with the running desktop app — no extra setup.

> If Chrome later disables it on restart, come back to `chrome://extensions` and re-enable
> it. This is normal for extensions loaded outside the Web Store.

---

## 3. Redeem your comp code

Your code looks like this:

```
TLY-XXXX-XXXX
```

You can redeem it two ways — either works, same result.

### Option A — inside the desktop app (recommended)

1. Open the Talysman desktop app.
2. Click **Account** in the left sidebar.
3. Sign in, or create an account if you don't have one yet. (The code unlocks Pro on
   *your* account, so you need to be signed in first.)
4. Click **Redeem a code**.
5. Paste your code and click **Redeem**.

Your plan flips to **Pro** — you'll see the badge on the Account page update. It can take
up to about 5 minutes to sync everywhere.

### Option B — from the link I sent

If I sent you a link like `https://talysman.app/redeem/TLY-XXXX-XXXX`, just open it in your
browser. If you're not signed in, it'll walk you through login/signup and bring you back to
the code. Redeeming is a single explicit click.

---

## You're set

- Desktop app installed and running ✅
- Chrome extension loaded ✅
- Account shows **Pro** ✅

From here, add sites to your **Blocklists**, set a **Schedule**, and explore. If anything
looks off, send me a screenshot of the **Account** page and what you were doing — thanks
for helping test!

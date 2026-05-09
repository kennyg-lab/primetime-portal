# Prime Time Electricians — Report Portal

A private web portal for generating branded insurance inspection reports.

---

## Deploy to Railway (5 minutes)

### Step 1 — GitHub
1. Create a free account at github.com
2. Create a new repository called `primetime-portal`
3. Upload all files from this folder into it

### Step 2 — Railway
1. Go to railway.app and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Select your `primetime-portal` repository
4. Railway will auto-detect Node.js and deploy

### Step 3 — Environment Variables
In Railway, go to your project → **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | Your key from console.anthropic.com |
| `PORTAL_PASSWORD` | Your chosen team password |
| `SESSION_SECRET` | Any random string (e.g. `pt-secret-abc123`) |

### Step 4 — Get your URL
Railway gives you a URL like `primetime-portal.up.railway.app`
Share this with your team — they log in with the team password.

---

## Usage

1. Open your Railway URL in any browser
2. Enter the team password
3. Fill in the job details
4. Click **⚡ Generate Report** — Claude writes the report
5. Review the report on screen
6. Click **↓ Export PDF** — branded PDF downloads instantly

---

## Updating the password
Go to Railway → Variables → change `PORTAL_PASSWORD` → redeploy.

## Custom domain
In Railway → Settings → Domains → add your own domain (e.g. `reports.primetimewa.com.au`)

---

## Local development

```bash
npm install
cp .env.example .env
# Edit .env with your API key and password
node server.js
# Open http://localhost:3000
```

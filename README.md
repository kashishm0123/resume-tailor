# Resume Tailor

A small web app that tailors your resume to a job, keeps every tailored version in a catalogue, and shows you exactly what changed and why.

## How it works

1. **Add your resume once.** Upload a PDF, DOCX, TXT or MD file, or paste the text. It's converted to editable Markdown. Use **Edit** to check or fix it.
2. **Paste a job link or a job description** into the same box. The app works out which one you gave it.
   - **Link:** the app first looks for the structured job data that most job boards publish (Lever, Workday, Indeed, LinkedIn public pages…). If that's missing, Claude reads the page text and pulls out the description.
   - **If the page can't be read** (login wall, blocked, rendered by JavaScript), you get step-by-step instructions to copy the description and paste it back.
3. **Review the result:**
   - **What changed**: every edit, with the before and after text highlighted and the part of the job that prompted it, plus the job keywords that were added.
   - **Gaps**: requirements the job lists that your real experience doesn't show. The app never invents experience.
   - **Tailored resume**: Save as PDF, download .md, copy, or edit.
   - **Full comparison**: word-by-word diff against your original.

## Where your data lives

Your resume and the catalogue are stored **in your browser** (IndexedDB), not on the server. Each browser or device has its own catalogue. Use **Export backup** in the sidebar to download everything as a JSON file, and **Import** to restore it or move it to another device.

## Run it on your Mac

Double-click **`start.command`**. It opens http://localhost:4747. Or:

```bash
npm install
npm start
```

Locally, the app asks for your Anthropic API key in Settings (⚙) and saves it in `data/config.json`, which is git-ignored.

## Host it on Render (free)

1. Sign in at https://render.com with GitHub.
2. Choose **New → Blueprint** and pick this repo. Render reads `render.yaml`.
3. Fill in the two secrets it asks for:
   - `ANTHROPIC_API_KEY`: your key from console.anthropic.com
   - `APP_PASSWORD`: any password. The browser asks for it the first time you open the site (the username can be anything).
4. Deploy. Your site is at `https://resume-tailor-XXXX.onrender.com`.

On the free plan, the site sleeps after 15 minutes of inactivity. The first visit after that takes about 30–50 seconds to wake up. The server refuses to start on a public address unless `APP_PASSWORD` is set.

## Settings

Click ⚙ to pick the model: Claude Opus 5 (best quality, the default) or Claude Sonnet 5 (faster and cheaper). The choice is remembered per browser.

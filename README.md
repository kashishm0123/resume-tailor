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

## Host it on Google Cloud Run (no API key)

The hosted version uses **Workload Identity Federation**: Cloud Run gives the app a Google identity, and the Anthropic SDK exchanges it for a short-lived Claude token. No API key is stored anywhere.

1. **Google Cloud:** create a project, enable billing (this app fits in the free tier), and create a service account, e.g. `resume-tailor@PROJECT.iam.gserviceaccount.com`. Note its numeric unique ID.
2. **Claude Console → Settings → Workload identity → Connect workload → Google Cloud:**
   - Issuer: `https://accounts.google.com` (discovery)
   - Rule match: audience `https://api.anthropic.com`, claims `sub` = the unique ID and `email` = the service account email
   - Note the rule ID (`fdrl_…`), service account ID (`svac_…`), organization ID and workspace ID.
3. **Cloud Run:** deploy this repo (it has a `Dockerfile`), run it as the service account above, allow unauthenticated access (the app has its own password), and set these environment variables:

| Variable | Value |
|---|---|
| `ANTHROPIC_FEDERATION_RULE_ID` | `fdrl_…` |
| `ANTHROPIC_ORGANIZATION_ID` | your organization UUID |
| `ANTHROPIC_SERVICE_ACCOUNT_ID` | `svac_…` |
| `ANTHROPIC_WORKSPACE_ID` | `wrkspc_…` (optional if the rule covers one workspace) |
| `APP_PASSWORD` | the password the browser asks for |

Do **not** set `ANTHROPIC_API_KEY` there. The server refuses to start on a public address without `APP_PASSWORD`.

## Settings

Click ⚙ to pick the model: Claude Opus 5 (best quality, the default) or Claude Sonnet 5 (faster and cheaper). The choice is remembered per browser.

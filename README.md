# CSIT Study Buddy

A local web app for browsing the TU B.Sc. CSIT course catalog by semester and studying with a Gemini-powered tutor.

Selecting a course opens its unit list when detailed units are available in the supplied PDF. Use **Practise this unit** to ask Gemini for original exercises and explained answers. For courses without unit details in the PDF, the app offers an explicitly unverified, AI-generated general outline instead.

The course catalog is on `index.html`; the standalone assistant is on `assistant.html`. From the course guide, a unit's practice link opens the assistant with the course and unit selected.

## Requirements

- Node.js 22.9 or newer
- A Google Gemini API key to use the AI tutor

## Run on Windows

1. Copy `.env.example` to `.env`.
2. Add your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) as the `GEMINI_API_KEY` value in `.env`. Keep `.env` private; it is excluded by `.gitignore`.
3. Open PowerShell in this folder and run:

   ```powershell
   npm start
   ```

4. Open [http://localhost:8000](http://localhost:8000).
5. To stop the app, press **Ctrl+C** in PowerShell.

The server listens on `127.0.0.1` so the app is available on this laptop only. The Gemini key is read by the server and is never sent to browser code. Gemini API usage may be subject to Google's limits or charges; check your key's access restrictions and usage in AI Studio.

## Deploy to Vercel

1. Install or run the Vercel CLI, sign in, and deploy this folder:

   ```powershell
   npx vercel
   ```

2. In the Vercel project settings, add `GEMINI_API_KEY` as an encrypted Environment Variable for Production (and Preview if wanted), then redeploy. Do not copy `.env` into the deployment; `.vercelignore` excludes it.
3. Add `GEMINI_MODEL` if you want to override the default model.

The static course pages deploy separately from the `/api/chat` and `/api/health` serverless functions. The API key must be configured in Vercel before AI responses can work. A public deployment allows visitors to use the AI endpoint and consume the configured Gemini quota.

## Local API

- `GET /api/health` reports whether a server-side Gemini key is configured; it never returns the key.
- `POST /api/chat` accepts JSON with `message`, `semester`, `courseCode`, and up to 8 prior `history` messages (`role` and `text`). The server validates the selected course against the local catalog and returns `{ "reply": "..." }`.
- Invalid input returns `400`; an oversized request returns `413`; an unset key returns `503`; provider rate limits return `429`; upstream/network failures return `502` or `504`.

## Syllabus data

The supplied PDF lists the catalog for all eight semesters and the elective options. It identifies a 2017 curriculum effective from academic year 2074, and its detailed unit outlines cover Semesters I–IV. This is not verified as the current TU curriculum.

## Tests

```powershell
npm test
```

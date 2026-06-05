# Vercel Deployment

This project deploys both frontend and backend on Vercel:

- Frontend: static files from `public/`
- Backend: Express app through `api/index.js`
- API routes stay the same, for example `/api/claims/submit`

## Required Environment Variables

Set these in Vercel Project Settings > Environment Variables:

```text
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/plum_opd_claims
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_BASE_URL=https://api.groq.com/openai/v1/chat/completions
PDF_MAX_PAGES=5
```

Do not add `.env` to Git.

## Deploy From CLI

```powershell
npm install
npx vercel
npx vercel --prod
```

## Deploy From GitHub

1. Push this folder to GitHub.
2. Import the repo in Vercel.
3. Framework preset: `Other`.
4. Build command: leave empty.
5. Output directory: leave empty.
6. Add the environment variables above.
7. Deploy.

## After Deploy

Open:

```text
https://your-project.vercel.app
```

Check backend:

```text
https://your-project.vercel.app/api/health
```

## Note About File Uploads

Vercel serverless functions have request size and execution-time limits. Small images/text JSON tests are fine, but large PDFs or many high-resolution images may need a separate file storage flow later.

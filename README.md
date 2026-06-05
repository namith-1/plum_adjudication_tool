# Plum OPD Claim Adjudication Tool

Mongo-backed OPD claim adjudication app for testing document extraction, preliminary policy checks, AI-assisted adjudication, and manual review workflows.

The app has:

- Static frontend in `public/`
- Express API in `src/`
- Vercel serverless entrypoint in `api/index.js`
- MongoDB Atlas/Mongoose persistence
- Groq vision/text extraction and adjudication
- RAG-style compact policy/rule retrieval before AI adjudication

## Features

- Upload images, PDFs, DOCX, text files, or extracted JSON for OPD claim testing.
- Extract document facts, visual markers, stamps/signatures/logos, dates, unmapped fields, and confidence signals.
- Verify member and active policy from MongoDB.
- Infer treatment date from documents instead of trusting user input.
- Check waiting period, submission timeline, policy limits, duplicate treatment date claims, missing documents, pre-auth, exclusions, and annual utilization.
- Route blurry/empty/low-confidence documents to re-upload instead of hallucinating.
- Support normal and strict adjudication modes.
- Save manual-review claims to DB from the UI.
- Add users, dependents, policies, and policy links from the UI.

## Tech Stack

- Node.js
- Express
- MongoDB Atlas
- Mongoose
- Groq API
- Vanilla HTML/CSS/JS frontend
- Vercel deployment

## Project Structure

```text
api/index.js                         Vercel serverless entrypoint
public/                              Frontend app
src/app.js                           Express app definition
src/server.js                        Local server runner
src/models/                          Mongoose schemas
src/routes/                          API routes
src/services/                        Claim, extraction, RAG, policy, persistence services
src/prompts/                         Groq extraction/adjudication prompts
scripts/seedTestData.js              Seed policy and test users
scripts/validateTestCases.js         Deterministic local test cases
scripts/testGroqCases.js             Groq-backed one-by-one test runner
docs/documentation.md                Architecture, API, flow, assumptions
policy_terms.json                    Example policy terms
test_cases.json                      Assignment test cases
vercel.json                          Vercel routing config
```

## Local Setup

1. Install dependencies:

```powershell
npm install
```

2. Create `.env`:

```text
PORT=4000
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/plum_opd_claims
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_BASE_URL=https://api.groq.com/openai/v1/chat/completions
PDF_MAX_PAGES=5
```

3. Seed policy and test users:

```powershell
npm run seed:test-data
```

4. Start the app:

```powershell
npm start
```

5. Open:

```text
http://127.0.0.1:4000
```

## Tests

Run deterministic local tests:

```powershell
npm run test:cases
```

Run Groq-backed tests one by one:

```powershell
npm run test:cases:grok
```

Run one Groq case:

```powershell
npm run test:cases:grok -- --case TC001 --delay-ms 0
```

Expected outputs are not sent to Groq. The script sends claim input and extracted test JSON to the adjudication pipeline, then compares locally.

## Deployment On Vercel

Import the GitHub repository in Vercel.

Settings:

```text
Root Directory: ./
Framework Preset: Other
Install Command: npm install
Build Command: leave empty
Output Directory: leave empty
```

Environment variables:

```text
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/plum_opd_claims
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_BASE_URL=https://api.groq.com/openai/v1/chat/completions
PDF_MAX_PAGES=5
```

MongoDB Atlas Network Access should allow Vercel to connect. For demo deployments, `0.0.0.0/0` is the simplest option.

After deploy:

```text
https://your-project.vercel.app
https://your-project.vercel.app/api/health
```

## API Summary

Main claim routes:

- `POST /api/claims/submit`
- `POST /api/claims/test-json`
- `POST /api/claims/verify`
- `POST /api/claims/save-manual-review`

Extraction routes:

- `POST /api/extractions/groq`
- `POST /api/extractions/grok`

Admin setup routes:

- `GET /api/admin/users`
- `POST /api/admin/users`
- `GET /api/admin/policies`
- `POST /api/admin/policies`
- `POST /api/admin/user-policies`

Full API documentation, architecture diagram, decision flowchart, and assumptions are in [docs/documentation.md](docs/documentation.md).

## Notes

- `.env` is ignored and must not be committed.
- Vercel serverless functions have request size and timeout limits. Very large PDFs or many high-resolution images may need object storage and async processing later.
- This is a preliminary adjudication tool, not a final production claim payment engine.

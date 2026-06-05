# Plum OPD Claim Adjudication Tool - Submission Details

## 1. Working Application

**Deployed application URL:**  
https://plum-adjudication-tool.vercel.app/

**Source code repository:**  
https://github.com/namith-1/plum_adjudication_tool

## 2. README

**Clear README with setup instructions:**  
[README.md](README.md)

**GitHub link:**  
https://github.com/namith-1/plum_adjudication_tool/blob/main/README.md

The README includes:

- Local setup instructions
- Environment variables
- MongoDB seed command
- Test commands
- Vercel deployment instructions
- API summary

## 3. Documentation

**Main documentation file:**  
[docs/documentation.md](docs/documentation.md)

**GitHub link:**  
https://github.com/namith-1/plum_adjudication_tool/blob/main/docs/documentation.md

The documentation includes:

- Architecture diagram
- API documentation
- Decision logic flowchart
- List of assumptions made

**Policy coverage details:**  
[docs/policy_coverage_details.md](docs/policy_coverage_details.md)

**GitHub link:**  
https://github.com/namith-1/plum_adjudication_tool/blob/main/docs/policy_coverage_details.md

## 4. Demo Video

**Demo video link:**  
`TO_BE_ADDED`

Suggested demo video structure, 5 to 10 minutes:

### Walk Through The User Flow

- Open the deployed application.
- Show the Claim Tester tab.
- Show document upload, JSON output, and decision summary.
- Show the Add Data tab for adding users, dependents, policies, and linking policies.

### Explain The Technical Approach

- Frontend is a static HTML/CSS/JS app.
- Backend is Express with a Vercel serverless entrypoint.
- MongoDB Atlas stores users, policies, policy links, and claims.
- Groq is used for document extraction and AI adjudication.
- RAG-style compact policy/rule retrieval is used before AI adjudication.
- Backend guards enforce hard rules after AI output.

### Demonstrate 2-3 Test Cases

- Approved claim example: `TC001` Simple Consultation.
- Rejected claim example: `TC004` Missing Documents or `TC009` Service Not Covered.
- Manual review example: `TC008` Multiple same-day claims.

### Discuss Potential Improvements

- Add object storage for large PDFs/images.
- Add reviewer authentication and role-based access.
- Add claim audit trail and reviewer comments.
- Add async processing queue for large document batches.
- Improve RAG with vector search over larger policy documents.
- Add stronger fraud detection using historical claim patterns.
- Add production-grade observability, retries, and rate-limit handling.

## 5. Quick Test Commands

Seed MongoDB:

```powershell
npm run seed:test-data
```

Run deterministic test cases:

```powershell
npm run test:cases
```

Run one Groq-backed test case:

```powershell
npm run test:cases:grok -- --case TC001 --delay-ms 0
```

## 6. Environment Variables Required

```text
MONGO_URI
GROQ_API_KEY
GROQ_MODEL
GROQ_BASE_URL
PDF_MAX_PAGES
```

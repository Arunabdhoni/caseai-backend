# CaseAI Backend

Node.js backend that connects OOREP (verified Kent's Repertory database)
with Claude API for hallucination-free homoeopathic case analysis.

## How it works

```
Doctor submits case text
        |
Backend extracts symptom keywords
        |
OOREP searched for each symptom -> returns verified Kent rubrics
        |
Verified rubrics passed to Claude as context
        |
Claude selects clinically relevant rubrics with reasoning
        |
Structured JSON returned to frontend
```

## Setup (5 minutes)

### Step 1: Install Node.js

Download from https://nodejs.org (LTS version)
Verify: open terminal and type `node --version`

### Step 2: Download this folder

Place the caseai-backend folder anywhere on your computer.

### Step 3: Install dependencies

Open terminal inside the caseai-backend folder:

```
npm install
```

### Step 4: Start the server

```
npm start
```

You should see:
```
CaseAI Backend running on http://localhost:3001
```

### Step 5: Test it

Open browser and go to:
http://localhost:3001/health

You should see:
```json
{
  "status": "ok",
  "service": "CaseAI Backend",
  "oorep": "connected"
}
```

If oorep shows "connected" your database link is working.

---

## API Routes

### POST /analyze

Full case analysis with verified rubrics.

Request body:
```json
{
  "apiKey": "sk-ant-...",
  "patientName": "Ravi Kumar",
  "patientAge": "42 / M",
  "caseText": "Patient complains of severe anxiety about health..."
}
```

Response:
```json
{
  "success": true,
  "analysis": {
    "case_summary": "...",
    "selected_rubrics": [...],
    "missing_information": "...",
    "miasmatic_indicators": "...",
    "clinical_notes": "..."
  },
  "metadata": {
    "oorepAvailable": true,
    "verifiedRubricsFound": 12,
    "disclaimer": "..."
  }
}
```

### GET /rubrics?symptom=anxiety+health

Direct OOREP search. Returns raw Kent rubrics for a symptom.

### GET /health

Server and OOREP connection status.

---

## Deploying to Vercel (so doctors don't need to run it locally)

1. Create account at vercel.com
2. Install Vercel CLI: `npm install -g vercel`
3. Inside caseai-backend folder: `vercel`
4. Follow prompts
5. You get a URL like `https://caseai-backend.vercel.app`
6. Update your frontend HTML to point to this URL instead of localhost

---

## Cost

This backend itself costs nothing to run.
Costs are only from API usage:
- Claude API: ~₹8 per case analysis (Sonnet 4.6)
- OOREP: Free (open source database)
- Sarvam AI (when added): ₹30/hour of audio

---

## Disclaimer

This tool assists qualified homoeopathic practitioners.
It does not replace clinical judgment.
Always verify rubrics in physical repertory before prescribing.

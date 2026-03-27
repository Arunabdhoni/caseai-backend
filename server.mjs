/**
 * CaseAI Backend Server
 * Connects OOREP verified Kent repertory data with Claude API
 * for hallucination-free homoeopathic case analysis
 */

import express from 'express';
import cors from 'cors';
import { createOOREPClient } from 'oorep-mcp';

const app = express();
app.use(cors());
app.use(express.json());

// ─── OOREP CLIENT ──────────────────────────────────────────────────────────────
const oorep = createOOREPClient({
  baseUrl: 'https://www.oorep.com',
  timeoutMs: 15000,
  maxResults: 10,
});

// ─── HOMOEOPATHIC SYSTEM PROMPT ───────────────────────────────────────────────
const HOMOEO_SYSTEM_PROMPT = `You are an expert classical homoeopathic physician and Repertory specialist trained in Kent's methodology, Boenninghausen's principles, and Hahnemann's Organon. You assist qualified homoeopathic doctors with case analysis.

You will be given:
1. A patient case (text from consultation)
2. VERIFIED rubrics retrieved from Kent's Repertory database (OOREP)

Your job is to:
- Select the most clinically relevant rubrics from the verified list
- Apply the correct symptom hierarchy (Mental Generals > Physical Generals > Particulars)
- Identify SRP (Strange, Rare, Peculiar) symptoms
- Generate a structured case analysis

SYMPTOM HIERARCHY (strictly follow this):
LEVEL 1 - MENTAL GENERALS: Emotions, will, intellect, fears, anxiety, grief (HIGHEST PRIORITY)
LEVEL 2 - PHYSICAL GENERALS: Thermals, thirst, appetite, sleep, perspiration, desires/aversions
LEVEL 3 - PARTICULARS: Organ-specific symptoms (LOWEST PRIORITY unless SRP)

WHAT TO IGNORE (do not repertorize):
- Common pathological symptoms (fever in infection, pain in injury)
- Universal symptoms (tiredness when ill)
- Symptoms without any modality unless very peculiar
- Maintaining causes still present

RUBRIC SELECTION RULES:
- Select 5 to 8 most characteristic rubrics from the verified list provided
- Prefer complete symptoms (location + sensation + modality)
- Mark SRP symptoms explicitly
- Never invent rubrics not in the verified list provided
- If no verified rubric fits a symptom, say "No verified rubric found"

OUTPUT: Respond ONLY with valid JSON, no preamble, no markdown:
{
  "case_summary": "3-4 sentences summarizing the case with symptom hierarchy",
  "selected_rubrics": [
    {
      "rubric": "exact rubric name from verified list",
      "chapter": "MIND / GENERALS / HEAD etc",
      "remedies": "top remedies with grades from verified data",
      "priority": "Mental General / Physical General / Particular",
      "srp": true or false,
      "reason": "why this rubric was selected"
    }
  ],
  "ignored_symptoms": "symptoms present but not repertorized and why",
  "missing_information": "specific questions doctor should ask for better repertorization",
  "miasmatic_indicators": "Psora / Sycosis / Syphilis / Tubercular indicators if present",
  "clinical_notes": "obstacles to cure, maintaining causes, other observations"
}`;

// ─── HELPER: Extract symptom keywords from case text ──────────────────────────
function extractSymptomKeywords(caseText) {
  // Key symptom domains to search OOREP for
  const domains = [
    // Mental generals
    { pattern: /anxi|fear|fright|grief|anger|irritab|sad|depress|worry|nervous/i, query: 'anxiety' },
    { pattern: /fear\s+(of\s+)?(death|dark|alone|crowd|height|dog|water)/i, query: 'fear' },
    { pattern: /jealous|suspicious|mistrust/i, query: 'jealousy' },
    { pattern: /memory|forget|absent/i, query: 'memory weakness' },
    // Physical generals
    { pattern: /thirst|drink|water/i, query: 'thirst' },
    { pattern: /cold|chilly|warm|heat|hot patient/i, query: 'chilly' },
    { pattern: /sweat|perspir/i, query: 'perspiration' },
    { pattern: /sleep|insomn|waking/i, query: 'sleep' },
    { pattern: /desire|craving|aversion|appetite/i, query: 'desires' },
    // Head
    { pattern: /headache|head pain|migrain/i, query: 'headache' },
    // GIT
    { pattern: /nausea|vomit|stomach|gastric|acidity/i, query: 'nausea' },
    { pattern: /constipat|stool|diarrhea|loose/i, query: 'constipation' },
    // Respiratory
    { pattern: /cough|cold|coryza|sneez/i, query: 'cough' },
    { pattern: /asthma|breath|wheez/i, query: 'asthma' },
    // Skin
    { pattern: /itch|eruption|rash|skin/i, query: 'itching skin' },
    // Modalities
    { pattern: /worse morning|agg morning/i, query: 'worse morning' },
    { pattern: /worse night|agg night/i, query: 'worse night' },
    { pattern: /worse cold|agg cold/i, query: 'worse cold' },
    { pattern: /worse heat|agg heat/i, query: 'worse warmth' },
    { pattern: /worse motion|agg motion/i, query: 'worse motion' },
    { pattern: /better rest|ameliorate rest/i, query: 'better rest' },
  ];

  const queries = new Set();
  for (const { pattern, query } of domains) {
    if (pattern.test(caseText)) {
      queries.add(query);
    }
  }

  // Always search for the most common generals as baseline
  queries.add('anxiety');
  queries.add('thirst');

  return Array.from(queries).slice(0, 8); // Max 8 searches to avoid rate limits
}

// ─── HELPER: Search OOREP for multiple symptoms ────────────────────────────────
async function searchVerifiedRubrics(symptoms) {
  const allRubrics = [];
  const errors = [];

  for (const symptom of symptoms) {
    try {
      const result = await oorep.searchRepertory({
        symptom,
        repertory: 'kent-en', // Kent's English repertory
        maxResults: 5,
        minWeight: 2, // Grade 2+ remedies only
      });

      if (result && result.rubrics && result.rubrics.length > 0) {
        for (const rubric of result.rubrics) {
          allRubrics.push({
            rubric: rubric.rubricPath || rubric.text || rubric.name || symptom,
            chapter: rubric.chapter || 'Unknown',
            remedies: rubric.remedies || [],
            searchTerm: symptom,
            verified: true,
          });
        }
      }
    } catch (err) {
      errors.push({ symptom, error: err.message });
    }
  }

  return { rubrics: allRubrics, errors };
}

// ─── HELPER: Format rubrics for Claude context ─────────────────────────────────
function formatRubricsForClaude(rubrics) {
  if (!rubrics.length) return 'No verified rubrics found from database.';

  const lines = rubrics.map((r, i) => {
    const remedyStr = Array.isArray(r.remedies)
      ? r.remedies
          .slice(0, 8)
          .map((rem) => {
            const name = rem.nameAbbrev || rem.nameLong || rem.name || '?';
            const grade = rem.weight || rem.grade || 1;
            return `${name}(${grade})`;
          })
          .join(', ')
      : 'See repertory';

    return `${i + 1}. [VERIFIED] ${r.rubric}\n   Remedies: ${remedyStr}`;
  });

  return lines.join('\n\n');
}

// ─── MAIN ROUTE: Analyze Case ─────────────────────────────────────────────────
app.post('/analyze', async (req, res) => {
  const { caseText, patientName, patientAge, apiKey } = req.body;

  if (!caseText || !apiKey) {
    return res.status(400).json({ error: 'caseText and apiKey are required' });
  }

  try {
    // Step 1: Extract symptom keywords from case
    const symptoms = extractSymptomKeywords(caseText);

    // Step 2: Search OOREP for verified rubrics
    let verifiedRubrics = [];
    let rubricErrors = [];
    let oorepAvailable = true;

    try {
      const { rubrics, errors } = await searchVerifiedRubrics(symptoms);
      verifiedRubrics = rubrics;
      rubricErrors = errors;
    } catch (oorepErr) {
      oorepAvailable = false;
      console.warn('OOREP unavailable, proceeding with Claude memory only:', oorepErr.message);
    }

    // Step 3: Format verified rubrics as context for Claude
    const verifiedContext = verifiedRubrics.length > 0
      ? `\n\nVERIFIED RUBRICS FROM KENT'S REPERTORY (OOREP DATABASE):\n${formatRubricsForClaude(verifiedRubrics)}\n\nIMPORTANT: Select ONLY from these verified rubrics. Do not invent rubrics not listed above.`
      : '\n\nNOTE: OOREP database unavailable. Use your training knowledge for rubrics but mark each as "UNVERIFIED - confirm in physical repertory".';

    // Step 4: Call Claude API with verified rubric context
    const userMessage = `Analyze this homoeopathic case:

PATIENT: ${patientName || 'Unknown'}, ${patientAge || 'Age not recorded'}

CASE:
${caseText}
${verifiedContext}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: HOMOEO_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.json();
      return res.status(claudeResponse.status).json({
        error: err.error?.message || 'Claude API error',
      });
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content.map((b) => b.text || '').join('');
    const clean = rawText.replace(/```json|```/g, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse AI response. Try again.' });
    }

    // Step 5: Return structured response with metadata
    return res.json({
      success: true,
      analysis,
      metadata: {
        oorepAvailable,
        verifiedRubricsFound: verifiedRubrics.length,
        symptomsSearched: symptoms,
        rubricSearchErrors: rubricErrors,
        disclaimer:
          'AI-assisted repertorization. Always verify in physical repertory before prescribing.',
      },
    });
  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── ROUTE: Search rubrics directly ──────────────────────────────────────────
app.get('/rubrics', async (req, res) => {
  const { symptom, repertory = 'kent-en', maxResults = 10 } = req.query;

  if (!symptom) {
    return res.status(400).json({ error: 'symptom query parameter required' });
  }

  try {
    const result = await oorep.searchRepertory({
      symptom,
      repertory,
      maxResults: parseInt(maxResults),
    });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE: Health check ──────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let oorepStatus = 'unknown';
  try {
    await oorep.searchRepertory({ symptom: 'anxiety', maxResults: 1 });
    oorepStatus = 'connected';
  } catch {
    oorepStatus = 'unavailable';
  }

  return res.json({
    status: 'ok',
    service: 'CaseAI Backend',
    oorep: oorepStatus,
    timestamp: new Date().toISOString(),
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CaseAI Backend running on http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  POST /analyze  - Full case analysis with OOREP + Claude');
  console.log('  GET  /rubrics  - Direct OOREP rubric search');
  console.log('  GET  /health   - Server health check');
});

/**
 * CaseAI Backend Server v2
 * OOREP verified rubrics + Claude with full remedy grading
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

// ─── SYSTEM PROMPT WITH REMEDY GRADING ────────────────────────────────────────
const HOMOEO_SYSTEM_PROMPT = `You are an expert classical homoeopathic physician and Repertory specialist trained in Kent's methodology, Boenninghausen's principles, and Hahnemann's Organon. You assist qualified homoeopathic doctors with case analysis.

You will be given:
1. A patient case (text from consultation)
2. VERIFIED rubric names retrieved from Kent's Repertory database (OOREP)

SYMPTOM HIERARCHY (strictly follow):
LEVEL 1 - MENTAL GENERALS: Emotions, will, intellect, fears, anxiety, grief (HIGHEST PRIORITY)
LEVEL 2 - PHYSICAL GENERALS: Thermals, thirst, appetite, sleep, perspiration, desires/aversions
LEVEL 3 - PARTICULARS: Organ-specific symptoms (LOWEST PRIORITY unless SRP)

WHAT TO IGNORE:
- Common pathological symptoms (fever in infection, pain in injury)
- Universal symptoms (tiredness when ill)
- Symptoms without any modality unless very peculiar
- Maintaining causes still present

RUBRIC SELECTION:
- Select 5 to 8 most characteristic rubrics from the verified list
- Prefer complete symptoms (location + sensation + modality)
- Mark SRP (Strange Rare Peculiar) symptoms explicitly

REMEDY GRADING (most important part):
For EVERY selected rubric, list remedies from Kent's Repertory with grades:
- Grade 3 = CAPITALS e.g. ARS, PULS, SULPH (found in majority of provers, clinically verified)
- Grade 2 = Title Case e.g. Calc, Lyc, Nat-m (found in few provers, occasionally verified)
- Grade 1 = lowercase e.g. acon, bell, bry (clinical symptoms, not fully proven)
Format: "ARS(3), PULS(3), Calc(2), Lyc(2), Nat-m(2), acon(1), bell(1)"
Standard abbreviations: Ars=Arsenicum album, Puls=Pulsatilla, Sulph=Sulphur, Calc=Calcarea carb, Lyc=Lycopodium, Nat-m=Natrum muriaticum, Nux-v=Nux vomica, Sep=Sepia, Sil=Silicea, Thuj=Thuja, Bar-c=Baryta carb, Bry=Bryonia, Bell=Belladonna, Acon=Aconitum, Phos=Phosphorus, Graph=Graphites, Lach=Lachesis, Merc=Mercurius, Ign=Ignatia, Staph=Staphysagria, Caust=Causticum, Kali-c=Kali carbonicum, Arg-n=Argentum nitricum, Gels=Gelsemium, Rhus-t=Rhus tox, Apis=Apis mellifica, Carb-v=Carbo veg
ALWAYS provide remedies for every rubric. Never leave remedies empty.

REPERTORIZATION SUMMARY:
After selecting rubrics, count which remedies appear most across all rubrics and add up their grades. Example: "ARS covers 6/7 rubrics total score 16, PULS covers 5/7 total score 12, Calc covers 4/7 total score 9"

OUTPUT: Respond ONLY with valid JSON, no preamble, no markdown backticks:
{
  "case_summary": "3-4 sentences summarizing the case with symptom hierarchy and most characteristic symptoms",
  "selected_rubrics": [
    {
      "rubric": "MIND; ANXIETY; health, about",
      "chapter": "MIND",
      "remedies": "ARS(3), PULS(3), Calc(2), Lyc(2), Nat-m(2), acon(1), bell(1)",
      "priority": "Mental General",
      "srp": false,
      "reason": "Strong mental general, patient constantly anxious about health"
    }
  ],
  "repertorization_summary": "ARS covers 5/6 rubrics total score 14, PULS covers 4/6 total score 10, Calc covers 3/6 total score 8. Top three remedies to consider: Arsenicum album, Pulsatilla, Calcarea carb.",
  "ignored_symptoms": "Any symptoms present but not repertorized and exact reason why",
  "missing_information": "Specific questions doctor should still ask e.g. ask about thermal modality, ask about thirst quantity and temperature, ask about sleep position and time of waking",
  "miasmatic_indicators": "Psoric/Sycotic/Syphilitic/Tubercular indicators with reasoning. If not determinable state so clearly.",
  "clinical_notes": "Obstacles to cure, maintaining causes, or other clinically important observations"
}`;

// ─── EXTRACT SYMPTOM KEYWORDS ─────────────────────────────────────────────────
function extractSymptomKeywords(caseText) {
  const domains = [
    { pattern: /anxi|fear|fright|grief|anger|irritab|sad|depress|worry|nervous/i, query: 'anxiety' },
    { pattern: /fear\s+(of\s+)?(death|dark|alone|crowd|height|dog|water)/i, query: 'fear' },
    { pattern: /jealous|suspicious|mistrust/i, query: 'jealousy' },
    { pattern: /memory|forget|absent/i, query: 'memory weakness' },
    { pattern: /thirst|drink|water/i, query: 'thirst' },
    { pattern: /cold|chilly|warm|heat|hot patient/i, query: 'chilly' },
    { pattern: /sweat|perspir/i, query: 'perspiration' },
    { pattern: /sleep|insomn|waking/i, query: 'sleep' },
    { pattern: /desire|craving|aversion|appetite/i, query: 'desires' },
    { pattern: /headache|head pain|migrain/i, query: 'headache' },
    { pattern: /nausea|vomit|stomach|gastric|acidity/i, query: 'nausea' },
    { pattern: /constipat|stool|diarrhea|loose/i, query: 'constipation' },
    { pattern: /cough|cold|coryza|sneez/i, query: 'cough' },
    { pattern: /asthma|breath|wheez/i, query: 'asthma' },
    { pattern: /itch|eruption|rash|skin/i, query: 'itching skin' },
    { pattern: /worse morning|agg morning/i, query: 'worse morning' },
    { pattern: /worse night|agg night/i, query: 'worse night' },
    { pattern: /worse cold|agg cold/i, query: 'worse cold' },
    { pattern: /worse heat|agg heat/i, query: 'worse warmth' },
    { pattern: /worse motion|agg motion/i, query: 'worse motion' },
  ];

  const queries = new Set(['anxiety', 'thirst']);
  for (const { pattern, query } of domains) {
    if (pattern.test(caseText)) queries.add(query);
  }
  return Array.from(queries).slice(0, 8);
}

// ─── SEARCH OOREP ─────────────────────────────────────────────────────────────
async function searchVerifiedRubrics(symptoms) {
  const allRubrics = [];
  const errors = [];

  for (const symptom of symptoms) {
    try {
      const result = await oorep.searchRepertory({
        symptom,
        maxResults: 5,
        minWeight: 2,
      });

      if (result && result.rubrics && result.rubrics.length > 0) {
        for (const rubric of result.rubrics) {
          // Extract remedy names from whatever structure OOREP returns
          let remedyNames = [];
          if (Array.isArray(rubric.remedies)) {
            remedyNames = rubric.remedies
              .slice(0, 10)
              .map(r => {
                const name = r.nameAbbrev || r.nameLong || r.name || '';
                const grade = r.weight || r.grade || 1;
                return `${name}(${grade})`;
              })
              .filter(r => r.length > 3);
          }

          allRubrics.push({
            rubric: rubric.rubricPath || rubric.fullPath || rubric.text || rubric.name || symptom,
            chapter: rubric.chapter || rubric.section || 'Unknown',
            remedyString: remedyNames.join(', '),
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

// ─── FORMAT FOR CLAUDE ────────────────────────────────────────────────────────
function formatRubricsForClaude(rubrics) {
  if (!rubrics.length) return 'No verified rubrics retrieved. Use your training knowledge for rubric selection.';

  const lines = rubrics.map((r, i) => {
    const remedyPart = r.remedyString
      ? `\n   Known remedies: ${r.remedyString}`
      : '';
    return `${i + 1}. [VERIFIED from Kent's Repertory] ${r.rubric}${remedyPart}`;
  });

  return lines.join('\n\n');
}

// ─── MAIN ANALYZE ROUTE ───────────────────────────────────────────────────────
app.post('/analyze', async (req, res) => {
  const { caseText, patientName, patientAge, apiKey } = req.body;
  if (!caseText || !apiKey) {
    return res.status(400).json({ error: 'caseText and apiKey are required' });
  }

  try {
    const symptoms = extractSymptomKeywords(caseText);
    let verifiedRubrics = [];
    let rubricErrors = [];
    let oorepAvailable = true;

    try {
      const { rubrics, errors } = await searchVerifiedRubrics(symptoms);
      verifiedRubrics = rubrics;
      rubricErrors = errors;
    } catch (oorepErr) {
      oorepAvailable = false;
    }

    const verifiedContext = verifiedRubrics.length > 0
      ? `\n\nVERIFIED RUBRICS FROM KENT'S REPERTORY (OOREP):\n${formatRubricsForClaude(verifiedRubrics)}\n\nSelect from these verified rubrics. For each selected rubric, provide complete remedy grades from your Kent's Repertory knowledge even if the remedy list above is incomplete.`
      : `\n\nOOREP database unavailable. Use your Kent's Repertory training knowledge for rubric selection. Mark each rubric as requiring manual verification.`;

    const userMessage = `Analyze this homoeopathic case:

PATIENT: ${patientName || 'Unknown'}, ${patientAge || 'Age not recorded'}

CASE DETAILS:
${caseText}
${verifiedContext}

Provide complete remedy grades for every rubric. The repertorization summary showing which remedies cover the most rubrics is essential.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: HOMOEO_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.json();
      return res.status(claudeResponse.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content.map(b => b.text || '').join('');
    const clean = rawText.replace(/```json|```/g, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'Could not parse AI response. Try again.' });
    }

    return res.json({
      success: true,
      analysis,
      metadata: {
        oorepAvailable,
        verifiedRubricsFound: verifiedRubrics.length,
        symptomsSearched: symptoms,
        disclaimer: 'AI-assisted repertorization. Always verify in physical repertory before prescribing.',
      },
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── RUBRIC SEARCH ROUTE ──────────────────────────────────────────────────────
app.get('/rubrics', async (req, res) => {
  const { symptom, maxResults = 10 } = req.query;
  if (!symptom) return res.status(400).json({ error: 'symptom required' });
  try {
    const result = await oorep.searchRepertory({ symptom, maxResults: parseInt(maxResults) });
    return res.json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── HEALTH ROUTE ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let oorepStatus = 'unknown';
  try {
    await oorep.searchRepertory({ symptom: 'anxiety', maxResults: 1 });
    oorepStatus = 'connected';
  } catch {
    oorepStatus = 'unavailable';
  }
  return res.json({ status: 'ok', service: 'CaseAI Backend', oorep: oorepStatus, timestamp: new Date().toISOString() });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`CaseAI Backend v2 running on http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  POST /analyze  - Full case analysis with OOREP + Claude');
  console.log('  GET  /rubrics  - Direct OOREP rubric search');
  console.log('  GET  /health   - Server health check');
});

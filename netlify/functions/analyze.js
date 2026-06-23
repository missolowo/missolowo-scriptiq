exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { script, language } = JSON.parse(event.body);

    if (!script) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No script provided' }) };
    }

    const langInstruction = (!language || language === 'auto')
      ? 'Auto-detect the script language.'
      : `The script is in ${language}.`;

    const prompt = `You are a professional Nollywood film script breakdown supervisor with real production management experience. Analyze the following screenplay and extract ALL production elements professionally.

${langInstruction} Support English, Yoruba, Igbo, Hausa, and French.

SCREENPLAY:
${script}

Return ONLY valid JSON (no markdown, no explanation) in this exact structure:

{
  "title": "Script title or Untitled Script",
  "language_detected": "detected language",
  "total_scenes": number,
  "scenes": [
    {
      "scene_number": 1,
      "int_ext": "INT or EXT",
      "time_of_day": "DAY or NIGHT or DAWN or DUSK",
      "location": "Location name",
      "description": "One sentence summary of scene action",
      "cast": ["Character Name"],
      "props": ["prop item"],
      "costume": ["character: costume description"],
      "equipment": ["equipment item"],
      "production_notes": "Special requirements or notes"
    }
  ],
  "character_breakdown": [
    {
      "character": "CHARACTER NAME",
      "scenes": [1, 3, 5, 7],
      "total": 4
    }
  ],
  "outline_schedule": [
    {
      "set_location": "Location/Set Name",
      "scenes": [2, 4, 6, 8],
      "total": 4
    }
  ],
  "production_elements": {
    "all_cast": ["Character Name"],
    "all_props": ["prop item"],
    "all_costume": ["costume item"],
    "all_equipment": ["equipment item"],
    "special_requirements": ["special requirement"]
  }
}

IMPORTANT RULES:
1. character_breakdown: List EVERY character. Sort by total scenes HIGHEST to LOWEST.
2. outline_schedule: Group ALL scenes by location. Each unique location gets one entry.
3. scenes: Include EVERY scene. No limits.
4. If a category is empty use [].
5. Be thorough and accurate — this is a professional production document.`;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6IOHZ90KU-LB3BKhoBKYjumv4vkZlvuV1R-8yLiOyV_BQ';
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8000
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || 'API error' })
      };
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(parsed)
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to analyze script: ' + error.message })
    };
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { mode, topic, imageBase64, imageType } = req.body;

    if (!mode || (!topic && !imageBase64)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const modePrompts = {
      flashcards: `Generate exactly 8 flashcards from this material. Return ONLY valid JSON: {"cards":[{"front":"Question or term","back":"Answer or definition"},...]}. Cover the most important concepts. No preamble, no markdown, no code fences.`,
      quiz: `Generate a 6-question multiple choice quiz. Return ONLY valid JSON: {"questions":[{"question":"...","options":["A","B","C","D"],"correct":0},...]} where correct is the 0-based index. No preamble, no markdown, no code fences.`,
      summary: `Extract the 8-10 most important key points to study. Return ONLY valid JSON: {"points":["Key point 1","Key point 2",...]}. Make each concise and clear. No preamble, no markdown, no code fences.`
    };

    if (!modePrompts[mode]) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    // Build Gemini content parts
    const parts = [];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: imageType || 'image/jpeg',
          data: imageBase64
        }
      });
      parts.push({
        text: `Based on this image${topic ? ' about ' + topic : ''}, ${modePrompts[mode]}`
      });
    } else {
      parts.push({
        text: `Topic: ${topic}\n\n${modePrompts[mode]}`
      });
    }

    // Call Gemini API
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: 'You are a helpful study assistant. Always respond with valid JSON only â€” no markdown, no extra text, no code fences.' }]
          },
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1000
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('Gemini API error:', err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

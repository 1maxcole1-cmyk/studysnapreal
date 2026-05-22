export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get the API key from environment variables (never exposed to the browser)
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI is not set up correctly. Please try again later.' });
  }

  try {
    const { mode, topic, imageBase64, imageType, isPro } = req.body || {};

    // Validate inputs
    if (!mode || (!topic && !imageBase64)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const modePrompts = {
      flashcards: `Generate exactly 14 flashcards from this material. Return ONLY valid JSON: {"cards":[{"front":"Question or term","back":"Answer or definition"},...]}. Cover the most important concepts thoroughly. No preamble, no markdown.`,
      quiz: `Generate exactly 15 multiple choice questions. Return ONLY valid JSON: {"questions":[{"question":"...","options":["A","B","C","D"],"correct":0},...]} where correct is the 0-based index. Make the questions varied in difficulty and cover the material thoroughly. No preamble, no markdown.`,
      summary: `Extract the 12-14 most important key points to study. Return ONLY valid JSON: {"points":["Key point 1","Key point 2",...]}. Make each concise and clear. No preamble, no markdown.`
    };

    if (!modePrompts[mode]) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    // Build the user message for Groq (OpenAI-compatible chat format)
    let userContent;
    if (imageBase64) {
      const dataUrl = `data:${imageType || 'image/jpeg'};base64,${imageBase64}`;
      userContent = [
        { type: 'text', text: `Based on this image${topic ? ' about ' + topic : ''}, ${modePrompts[mode]}` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    } else {
      userContent = `Topic: ${topic}\n\n${modePrompts[mode]}`;
    }

    // Call the Groq API server-side (API key stays secret).
    // Pro/Premium members get the larger, smarter model; free users get the fast one.
    const model = isPro
      ? 'meta-llama/llama-4-maverick-17b-128e-instruct'
      : 'meta-llama/llama-4-scout-17b-16e-instruct';
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful study assistant. Always respond with valid JSON only — no markdown, no extra text, no code fences.' },
          { role: 'user', content: userContent }
        ],
        max_tokens: 4096,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!groqRes.ok) {
      // Log full details server-side only (visible in Vercel logs, never to users)
      const err = await groqRes.text();
      console.error('Groq API error:', groqRes.status, err);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (!text) {
      console.error('Empty Groq response:', JSON.stringify(data));
      return res.status(502).json({ error: 'AI service returned no content. Please try again.' });
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

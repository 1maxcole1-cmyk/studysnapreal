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
    const { mode, topic, imageBase64, imageType, plan } = req.body || {};

    // Validate inputs
    if (!mode || (!topic && !imageBase64)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Paid members (Pro & Premium) get study sets sized to fit the material;
    // free users get a fixed count. Premium also gets quiz answer explanations.
    const paid = plan === 'pro' || plan === 'premium';
    const premium = plan === 'premium';

    const fcInstr = paid
      ? 'one flashcard for each distinct concept, term, or fact in the material — cover all of it, but do not pad with filler or repeated cards. Make the set exactly as long as the material genuinely warrants, up to 60 cards'
      : 'one flashcard for each key concept in the material, with no filler or repeats — up to 25 cards';
    const quizInstr = paid
      ? 'one well-crafted multiple choice question for each distinct concept, fact, or idea in the material — cover all of it, but do not pad with filler, trivial, or repeated questions. Make the quiz exactly as long as the material genuinely warrants: a short topic gets a short quiz, a broad one gets a long exam-ready quiz of up to 60 questions'
      : 'one multiple choice question for each key concept in the material, with no filler or repeats — up to 25 questions';
    const summaryInstr = paid
      ? 'one key point for each distinct important idea in the material — cover all of it with no padding or repetition, up to 40 points'
      : 'the most important key points in the material, with no filler — up to 18 points';
    const explainField = premium ? ',"explanation":"one-sentence explanation of why the correct answer is right"' : '';
    const explainNote = premium ? ' Include a clear one-sentence explanation for every question.' : '';

    const quality = ' Every question must be clear, specific, and genuinely test understanding of the material — no vague or trivial questions. Cover a wide range of subtopics and vary the difficulty from easy to hard. All four options must be plausible, with exactly one correct.';

    const modePrompts = {
      flashcards: `Generate ${fcInstr}. Each flashcard should teach one important, specific idea — cover the material thoroughly and in depth. Return ONLY valid JSON: {"cards":[{"front":"Question or term","back":"Clear, accurate answer or definition"},...]}. No preamble, no markdown.`,
      quiz: `Generate ${quizInstr}.${quality} Return ONLY valid JSON: {"questions":[{"question":"...","options":["A","B","C","D"],"correct":0${explainField}},...]} where correct is the 0-based index.${explainNote} No preamble, no markdown.`,
      summary: `Identify ${summaryInstr}. Each point must be a complete, specific, genuinely useful study takeaway. Return ONLY valid JSON: {"points":["Key point 1","Key point 2",...]}. No preamble, no markdown.`
    };

    if (!modePrompts[mode]) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    // Build the user message for Groq (OpenAI-compatible chat format)
    const itemWord = mode === 'flashcards' ? 'flashcard' : mode === 'quiz' ? 'multiple choice question' : 'key point';
    let userContent;
    if (imageBase64) {
      const dataUrl = `data:${imageType || 'image/jpeg'};base64,${imageBase64}`;
      userContent = [
        { type: 'text', text: `Carefully read the actual text written in this image. Create one ${itemWord} for each term you can CLEARLY read in the image. CRITICAL RULES: (1) Use ONLY words and terms that are actually, visibly written in this specific image — quote them as they appear. (2) If any part of the image is blurry, rotated, angled, or unreadable, skip it — do NOT guess what it says. (3) NEVER fill in with common literary terms, definitions, or anything from your own general knowledge — only what is physically on this exact page. (4) It is far better to produce fewer cards than to include even one term that is not really in the image. (5) Never repeat the same term. ${modePrompts[mode]} Ignore any minimum or maximum count mentioned above — include only what you can genuinely read in the image, and nothing else.` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    } else {
      userContent = `Topic: ${topic}\n\n${modePrompts[mode]}`;
    }

    // Call the Groq API server-side (API key stays secret).
    // One reliable, vision-capable model for every tier.
    const model = 'meta-llama/llama-4-scout-17b-16e-instruct';
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
        max_tokens: 8000,
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

    // Remove duplicates the AI may have repeated
    const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const dedupe = (arr, keyFn) => {
      const seen = new Set();
      return arr.filter((item) => {
        const k = keyFn(item);
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    if (Array.isArray(parsed.cards)) {
      parsed.cards = dedupe(parsed.cards, (c) => norm(c && c.front));
    }
    if (Array.isArray(parsed.questions)) {
      parsed.questions = dedupe(parsed.questions, (q) => norm(q && q.question));
    }
    if (Array.isArray(parsed.points)) {
      parsed.points = dedupe(parsed.points, (p) => norm(p));
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

const https = require('https');
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

async function callOpenRouter(prompt, systemPrompt = 'You are an expert emergency medicine AI assistant. Provide detailed, professional medical assessments. Always respond with structured, actionable information.') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet-20241022';

  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return { result: 'AI service not configured. Please set OPENROUTER_API_KEY in .env file.', model, raw: null };
  }

  const data = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    max_tokens: 1500,
    temperature: 0.3
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'ER Triage AI'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            resolve({ result: `AI Error: ${parsed.error.message}`, model, raw: parsed });
          } else {
            const content = parsed.choices?.[0]?.message?.content || 'No response from AI';
            resolve({
              result: content,
              model: parsed.model || model,
              usage: parsed.usage,
              raw: parsed
            });
          }
        } catch (e) {
          resolve({ result: 'Failed to parse AI response', model, raw: body });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ result: `AI connection error: ${e.message}`, model, raw: null });
    });

    req.write(data);
    req.end();
  });
}

module.exports = { callOpenRouter };

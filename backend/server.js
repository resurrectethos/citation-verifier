export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') {
      return new Response(JSON.stringify({ message: 'This is the backend for the Citation Verifier application. Please use the frontend to access the service.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const { token, text } = await request.json();

    // In a real application, you would use a more robust user management system
    // and store usage data in a durable store like KV or D1.
    const users = {
      'user1-token': { usage: 0 },
      'user2-token': { usage: 0 },
    };

    if (!token || !users[token]) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const user = users[token];

    if (user.usage >= 2) {
      return new Response(JSON.stringify({ error: 'Usage limit exceeded.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      const analysis = await performAnalysis(text, env.DEEPSEEK_API_KEY);
      user.usage++; // Note: This is an in-memory increment, not durable.
      return new Response(JSON.stringify({ analysis }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
      },
    });
  }
}

async function performAnalysis(text, apiKey) {
  const callDeepSeek = async (messages, maxTokens = 8000) => {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: messages,
        max_tokens: maxTokens,
        temperature: 0.1,
        stream: false
      })
    });
    if (!response.ok) throw new Error(`DeepSeek API request failed: ${response.status}`);
    const data = await response.json();
    return data.choices[0].message.content;
  };

  const parseJSON = (text) => {
    let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.substring(start, end + 1);
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error('Failed to parse AI response');
    }
  };

  // Step 1: Extract
  const extractPrompt = `Analyze this academic text and extract key claims and citations.\n\nText: \"${text}\"\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT BEFORE OR AFTER THE JSON.\n\nFormat:\n{\n  \"keyClaims\": [\n    {\"claim\": \"text of claim\", \"requiresCitation\": true, \"hasCitation\": false, \"citationText\": \"author year or empty\"}\n  ],\n  \"explicitCitations\": [\n    {\"text\": \"citation as appears\", \"authors\": \"if identifiable\", \"year\": \"if identifiable\"}\n  ],\n  \"missingCitations\": [\"claim without proper citation\"],\n  \"documentType\": \"full article or abstract or other\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT ABOVE. DO NOT ADD ANY EXPLANATORY TEXT.`;
  const extractResponse = await callDeepSeek([{ role: "user", content: extractPrompt }], 8000);
  const extraction = parseJSON(extractResponse);

  // Step 2: Search
  const claimsToCheck = extraction.keyClaims.slice(0, 3);
  const searchResults = [];
  for (const claim of claimsToCheck) {
    const searchPrompt = `Assess the credibility and verifiability of this claim from an academic publication: \"${claim.claim}\"\n\n${claim.citationText ? `The claim cites: ${claim.citationText}` : 'No citation provided for this claim.'}\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"claim\": \"${claim.claim}\",\n  \"credibilityScore\": \"high or medium or low\",\n  \"supportingEvidence\": [\"brief point 1\", \"brief point 2\"],\n  \"contradictingEvidence\": [\"brief point if found\"],\n  \"retractionsFound\": false,\n  \"reasoning\": \"one sentence explanation\",\n  \"citationStatus\": \"properly cited or missing citation or questionable citation\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT.`;
    const searchResponse = await callDeepSeek([{ role: "user", content: searchPrompt }], 1500);
    searchResults.push(parseJSON(searchResponse));
  }

  // Step 3: Review
  const reviewPrompt = `You are a critical peer reviewer. Review this academic text based on the analysis below.\n\nDocument Type: ${extraction.documentType}\nKey Claims: ${JSON.stringify(extraction.keyClaims)}
Explicit Citations: ${JSON.stringify(extraction.explicitCitations)}
Missing Citations: ${JSON.stringify(extraction.missingCitations)}
Credibility Results: ${JSON.stringify(searchResults)}

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"overallAssessment\": \"high quality or medium quality or low quality\",\n  \"strengths\": [\"strength 1\", \"strength 2\"],\n  \"weaknesses\": [\"weakness 1\", \"weakness 2\"],\n  \"citationQuality\": \"one sentence assessment\",\n  \"majorConcerns\": [\"concern 1\", \"concern 2\"],\n  \"recommendations\": [\"recommendation 1\", \"recommendation 2\"],\n  \"verdict\": \"accept or minor revisions or major revisions or reject\",\n  \"documentTypeNote\": \"note about limitations if abstract only\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT BEFORE OR AFTER.`;
  const reviewResponse = await callDeepSeek([{ role: "user", content: reviewPrompt }], 2500);
  const review = parseJSON(reviewResponse);

  return { extraction, searchResults, review };
}
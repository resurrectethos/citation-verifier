export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/upload-users' && request.method === 'POST') {
      return handleUserUpload(request, env);
    }

    if (url.pathname === '/users' && request.method === 'GET') {
      return listUsers(env);
    }

    if (url.pathname === '/admin/usage-report' && request.method === 'GET') {
      return handleUsageReport(request, env);
    }

    if (url.pathname === '/admin/update-limit' && request.method === 'POST') {
      return updateUserLimit(request, env);
    }

    if (url.pathname === '/admin/hash' && request.method === 'GET') {
      const providedToken = new URL(request.url).searchParams.get('token');
      if (providedToken !== adminToken) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
        });
      }
      const textToHash = new URL(request.url).searchParams.get('text');
      if (!textToHash) {
        return new Response(JSON.stringify({ error: 'Missing text' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
        });
      }
      const hash = await hashToken(textToHash);
      return new Response(JSON.stringify({ text: textToHash, hash: hash }), {
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
      });
    }

    if (url.pathname.startsWith('/users/') && request.method === 'DELETE') {
      const token = url.pathname.split('/')[2];
      return deleteUser(token, env);
    }

    if (request.method === 'GET') {
      return new Response(JSON.stringify({ message: 'This is the backend for the Citation Verifier application. Please use the frontend to access the service.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
      });
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await request.json();
    const text = body.text;

    // Log the start of the analysis request
    logEvent('info', 'Analysis request received', { textLength: text?.length || 0, origin: request.headers.get('Origin') });

    try {
      validateAnalysisRequest({ text });
    } catch (e) {
      logEvent('warn', 'Invalid analysis request', { error: e.message });
      return new Response(JSON.stringify({ error: e.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
      });
    }

    let hashedToken;

    const authHeader = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (authHeader) {
      hashedToken = await hashToken(authHeader);
    } else if (body.token) {
      hashedToken = body.token;
    } else {
      logEvent('warn', 'Missing token in request');
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
      });
    }

    // Get the Durable Object stub for this user
    const id = env.RATE_LIMITER.idFromName(hashedToken);
    const stub = env.RATE_LIMITER.get(id);

    // Forward the request to the Durable Object to handle the analysis and rate limiting
    const doRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ hashedToken, text }),
    });

    return stub.fetch(doRequest);
  },
};

async function handleUserUpload(request, env) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('userFile');
    if (!file) {
      return new Response(JSON.stringify({ error: 'File not provided' }), { status: 400 });
    }
    const content = await file.text();
    const newUsers = content.split(/\n|,/).map(u => u.trim()).filter(Boolean);
    for (const user of newUsers) {
      const hashedToken = await hashToken(user);
      await env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify({ analyses: [], limit: 5, name: user }));
    }
    return new Response(JSON.stringify({ message: `${newUsers.length} users added.` }), {
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  } else {
    return new Response(JSON.stringify({ error: 'Invalid content type' }), { status: 400 });
  }
}

async function listUsers(env) {
  const keys = await env.CITATION_VERIFIER_USERS.list();
  const users = [];
  for (const key of keys.keys) {
    const user = await env.CITATION_VERIFIER_USERS.get(key.name, { type: 'json' });
    users.push({ name: user.name, limit: user.limit, analyses: user.analyses.length });
  }
  return new Response(JSON.stringify(users), {
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
  });
}

async function deleteUser(token, env) {
  const hashedToken = await hashToken(token);
  await env.CITATION_VERIFIER_USERS.delete(hashedToken);
  return new Response(JSON.stringify({ message: `User ${token} deleted.` }), {
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
  });
}

const adminToken = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

async function handleUsageReport(request, env) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'csv';
  const providedToken = url.searchParams.get('token');

  if (providedToken !== adminToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  }

  let headers = { ...getCorsHeaders(request, env) };
  let body;

  const data = [];
  const keys = await env.CITATION_VERIFIER_USERS.list();
  for (const key of keys.keys) {
    const user = await env.CITATION_VERIFIER_USERS.get(key.name, { type: 'json' });
    if (user.analyses.length > 0) {
      user.analyses.forEach(analysis => {
        data.push({
          hashedToken: key.name.substring(0, 16),
          user: user.name,
          articleTitle: analysis.articleTitle,
          wordCount: analysis.wordCount,
          overallAssessment: analysis.overallAssessment,
          date: analysis.date,
          analysisCount: user.analyses.length > 1 ? user.analyses.length : ''
        });
      });
    }
  }

  switch (format) {
    case 'html':
      headers['Content-Type'] = 'text/html';
      let table = '<table><tr><th>Hashed User Token</th><th>User</th><th>Article Title</th><th>Word Count</th><th>Overall Assessment</th><th>Date and Time</th><th>Count of Analysis</th></tr>';
      for (const row of data) {
        table += `<tr><td>${row.hashedToken}</td><td>${row.user}</td><td>${row.articleTitle}</td><td>${row.wordCount}</td><td>${row.overallAssessment}</td><td>${row.date}</td><td>${row.analysisCount}</td></tr>`;
      }
      table += '</table>';
      body = `<html><body><h1>Usage Report</h1>${table}</body></html>`;
      break;
    case 'pdf':
      headers['Content-Type'] = 'application/pdf';
      headers['Content-Disposition'] = 'attachment; filename="usage-report.pdf"';
      const { PDFDocument, rgb, PageSizes } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage(PageSizes.A4_Landscape);
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont('Helvetica');
      const boldFont = await pdfDoc.embedFont('Helvetica-Bold');
      const fontSize = 10;
      const margin = 50;
      const tableTop = height - margin - 50;

      page.drawText('Usage Report', { x: margin, y: height - margin, size: 24, font: boldFont, color: rgb(0, 0, 0) });

      const pdfTable = {
        x: margin,
        y: tableTop,
        width: width - 2 * margin,
        rows: [
          ['Hashed User Token', 'User', 'Article Title', 'Word Count', 'Overall Assessment', 'Date and Time', 'Count of Analysis'],
          ...data.map(row => [row.hashedToken, row.user, row.articleTitle, row.wordCount.toString(), row.overallAssessment, row.date, row.analysisCount.toString()])
        ],
        colWidths: [120, 100, 150, 80, 100, 120, 100],
      };

      let y = pdfTable.y;
      pdfTable.rows.forEach((row, rowIndex) => {
        let x = pdfTable.x;
        row.forEach((cell, colIndex) => {
          page.drawText(cell, { x: x + 5, y: y - 15, size: fontSize, font: rowIndex === 0 ? boldFont : font, color: rgb(0, 0, 0) });
          x += pdfTable.colWidths[colIndex];
        });
        y -= 20;
        page.drawLine({ start: { x: pdfTable.x, y: y + 5 }, end: { x: pdfTable.x + pdfTable.width, y: y + 5 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
      });

      body = await pdfDoc.save();
      break;
    default: // csv
      headers['Content-Type'] = 'text/csv';
      headers['Content-Disposition'] = 'attachment; filename="usage-report.csv"';
      let csv = 'hashed_user_token,user,article_title,word_count,overall_assessment,date_and_time,count_of_analysis\n';
      for (const row of data) {
        csv += `${row.hashedToken},${row.user},"${row.articleTitle}",${row.wordCount},${row.overallAssessment},${row.date},${row.analysisCount}\n`;
      }
      body = csv;
      break;
  }

  return new Response(body, { headers });
}

async function updateUserLimit(request, env) {
  const providedToken = new URL(request.url).searchParams.get('token');
  if (providedToken !== adminToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  }

  const { user, limit } = await request.json();
  if (!user || !limit) {
    return new Response(JSON.stringify({ error: 'Missing user or limit' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  }

  const hashedToken = await hashToken(user);
  const userData = await env.CITATION_VERIFIER_USERS.get(hashedToken, { type: 'json' });

  if (!userData) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  }

  userData.limit = limit;
  await env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify(userData));

  return new Response(JSON.stringify({ message: `User ${user} limit updated to ${limit}` }), {
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
  });
}

function validateAnalysisRequest(data) {
  const errors = [];
  if (!data.text || typeof data.text !== 'string') {
    errors.push('Text for analysis is required and must be a string.');
  } else {
    if (data.text.length < 10) {
      errors.push('Text must be at least 10 characters long.');
    }
    if (data.text.length > 50000) {
      errors.push('Text must not exceed 50,000 characters.');
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
}

function getArticleTitle(text) {
  const firstNLines = text.split('\n').slice(0, 10).join('\n');
  const potentialTitles = firstNLines.split('\n').filter(line => line.trim().length > 0 && line.split(' ').length > 3 && !line.toLowerCase().includes('abstract'));
  return potentialTitles.length > 0 ? potentialTitles[0].trim() : 'Untitled';
}

async function hashToken(token) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function logEvent(level, message, context = {}) {
  // In a real production app, you might integrate with a logging service here.
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  }));
}

function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  // Define allowed origins, with a fallback for the environment variable
  const allowedOrigins = [
    env.FRONTEND_URL || 'https://apps.edufusionai.co.za',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ];

  if (origin && allowedOrigins.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
  }

  // Return minimal headers if origin is not allowed
  return { 'Vary': 'Origin' };
}

// The static corsHeaders object is replaced by the dynamic getCorsHeaders function.

function handleOptions(request, env) {
  const corsHeaders = getCorsHeaders(request, env);
  if (corsHeaders['Access-Control-Allow-Origin']) {
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'POST, GET, DELETE, OPTIONS',
      },
    });
  }
}

const querySemanticScholar = async (claim) => {
  try {
    const response = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(claim)}&limit=5&fields=title,authors,year,venue,citationCount,abstract`
    );
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    logEvent('error', 'Semantic Scholar query failed', { error: error.message, stack: error.stack });
    return [];
  }
};

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
      }),
      signal: AbortSignal.timeout(30000) // 30-second timeout
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
  const extractPrompt = `Analyze this academic text and extract key claims and citations.\n\nText: \"${text}\"\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT BEFORE OR AFTER THE JSON.\n\nFormat:\n{\n  \"keyClaims\": [\n    {\"claim\": \"text of claim\", \"requiresCitation\": true, \"hasCitation\": false, \"citationText\": \"author year or empty\"}\n  ],
  \"explicitCitations\": [\n    {\"text\": \"citation as appears\", \"authors\": \"if identifiable\", \"year\": \"if identifiable\"}\n  ],
    \"missingCitations\": [\"claim without proper citation\"],
    \"documentType\": \"full article or abstract or other\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT ABOVE. DO NOT ADD ANY EXPLANATORY TEXT.`;
  const extractResponse = await callDeepSeek([{ role: "user", content: extractPrompt }], 8000);
  const extraction = parseJSON(extractResponse);

  // Step 2: Search
  const claimsToCheck = extraction.keyClaims.slice(0, 3);
  const searchResults = [];
  for (const claim of claimsToCheck) {
    const searchPrompt = `Assess the credibility and verifiability of this claim from an academic publication: \"${claim.claim}\"\n\n${claim.citationText ? `The claim cites: ${claim.citationText}` : 'No citation provided for this claim.'}\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"claim\": \"${claim.claim}\",\n  \"credibilityScore\": \"high or medium or low\",\n  \"supportingEvidence\": [\"brief point 1\", \"brief point 2\"],\n  \"contradictingEvidence\": [\"brief point if found\"],
  \"retractionsFound\": false,\n  \"reasoning\": \"one sentence explanation\",\n  \"citationStatus\": \"properly cited or missing citation or questionable citation\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT.`;
    const searchResponse = await callDeepSeek([{ role: "user", content: searchPrompt }], 1500);
    const deepSeekResult = parseJSON(searchResponse);
    const semanticScholarResults = await querySemanticScholar(claim.claim);
    
    deepSeekResult.semanticScholar = semanticScholarResults;

    searchResults.push(deepSeekResult);
  }

  // Step 3: Review
  const reviewPrompt = `You are a critical peer reviewer. Review this academic text based on the analysis below.\n\nDocument Type: ${extraction.documentType}\nKey Claims: ${JSON.stringify(extraction.keyClaims)}
Explicit Citations: ${JSON.stringify(extraction.explicitCitations)}
Missing Citations: ${JSON.stringify(extraction.missingCitations)}
Credibility Results: ${JSON.stringify(searchResults)}

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"overallAssessment\": \"high quality or medium quality or low quality\",\n  \"strengths\": [\"strength 1\", \"strength 2\"],\n  \"weaknesses\": [\"weakness 1\", \"weakness 2\"],\n  \"citationQuality\": \"one sentence assessment\",\n  \"majorConcerns\": [\"concern 1\", \"concern 2\"],
  \"recommendations\": [\"recommendation 1\", \"recommendation 2\"],
  \"verdict\": \"accept or minor revisions or major revisions or reject\",
  \"documentTypeNote\": \"note about limitations if abstract only\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT BEFORE OR AFTER.`;
  const reviewResponse = await callDeepSeek([{ role: "user", content: reviewPrompt }], 2500);
  const review = parseJSON(reviewResponse);

  return { analysis: { extraction, searchResults, review }, overallAssessment: review.overallAssessment };
}

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    // This method now contains the core analysis logic, ensuring that
    // requests for a single user are processed serially, preventing race conditions.
    try {
      const { hashedToken, text } = await request.json();

      logEvent('info', 'Rate limiter DO received request', { hashedToken: hashedToken.substring(0, 10), textLength: text?.length || 0 });

      const user = await this.env.CITATION_VERIFIER_USERS.get(hashedToken, { type: 'json' });

      if (!user) {
        logEvent('warn', 'User not found in DO', { hashedToken: hashedToken.substring(0, 10) });
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, this.env) },
        });
      }

      if (user.analyses.length >= user.limit) {
        logEvent('warn', 'Usage limit exceeded for user', { hashedToken: hashedToken.substring(0, 10), limit: user.limit });
        return new Response(JSON.stringify({ error: 'Usage limit exceeded.' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, this.env) },
        });
      }

      const { analysis, overallAssessment } = await performAnalysis(text, this.env.DEEPSEEK_API_KEY);
      const articleTitle = getArticleTitle(text);
      const wordCount = text.trim().split(/\s+/).length;
      
      user.analyses.push({ articleTitle, wordCount, overallAssessment, date: new Date().toISOString() });
      await this.env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify(user));
      
      logEvent('info', 'Analysis successful', { hashedToken: hashedToken.substring(0, 10) });

      return new Response(JSON.stringify({ analysis }), {
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, this.env) },
      });
    } catch (error) {
      logEvent('error', 'Analysis failed inside DO', { error: error.message, stack: error.stack });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, this.env) },
      });
    }
  }
}
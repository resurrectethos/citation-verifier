

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Admin authentication
    if (url.pathname.startsWith('/admin/')) {
      const adminToken = request.headers.get('X-Admin-Token');
      if (adminToken !== env.ADMIN_SECRET) {
        return new Response('Forbidden', { status: 403 });
      }
      
      // List users
      if (url.pathname === '/admin/users' && request.method === 'GET') {
        return await listUsers(env);
      }
      
      // Create user
      if (url.pathname === '/admin/users' && request.method === 'POST') {
        return await createUser(request, env);
      }
      
      // Delete user
      if (url.pathname.match(/^\/admin\/users\/[^\/]+$/) && request.method === 'DELETE') {
        const token = url.pathname.split('/').pop();
        return await deleteUser(token, env);
      }
    }

    if (url.pathname === '/admin/upload-users' && request.method === 'POST') {
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
      // The admin check is now handled by the centralized router.
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

    if (request.method === 'GET') {
      return new Response(JSON.stringify({ message: 'This is the backend for the Citation Verifier application. Please use the frontend to access the service.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
      });
    }

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    if (request.method === 'DELETE') {
      const body = await request.json();
      const hashedToken = body.hashedToken;
      const id = env.RATE_LIMITER.idFromName(hashedToken);
      const stub = env.RATE_LIMITER.get(id);
      return stub.fetch(request);
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
    const rows = content.split('\n').map(row => row.trim()).filter(Boolean);
    // Skip header row
    const users = rows.slice(1); 
    let count = 0;
    for (const user of users) {
      const [email, token] = user.split(',').map(item => item.trim());
      if (email && token) {
        const hashedToken = await hashToken(token);
        await env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify({ analyses: [], limit: 5, name: email }));
        count++;
      }
    }
    return new Response(JSON.stringify({ message: `${count} users added or updated.` }), {
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) },
    });
  } else {
    return new Response(JSON.stringify({ error: 'Invalid content type' }), { status: 400 });
  }
}

async function createUser(request, env) {
  try {
    const { email, limit = 5 } = await request.json();
    
    if (!email) {
      return errorResponse('Email is required', 'MISSING_EMAIL', 400);
    }
    
    // Generate a secure token
    const token = crypto.randomUUID();
    const hashedToken = await hashToken(token);
    
    // Create user object
    const userData = {
      email,
      limit,
      analyses: [],
      createdAt: new Date().toISOString()
    };
    
    // Store in KV
    await env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify(userData));
    
    logEvent('info', 'User created', { email, token: token.substring(0, 8) });
    
    return new Response(JSON.stringify({
      success: true,
      token,
      email,
      limit
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to create user', { error: error.message });
    return errorResponse('Failed to create user', 'CREATE_USER_FAILED', 500);
  }
}

async function listUsers(env) {
  try {
    const users = [];
    const list = await env.CITATION_VERIFIER_USERS.list();
    
    for (const key of list.keys) {
      const userData = await env.CITATION_VERIFIER_USERS.get(key.name);
      if (userData) {
        const parsed = JSON.parse(userData);
        users.push({
          email: parsed.email,
          limit: parsed.limit,
          usageCount: parsed.analyses?.length || 0,
          createdAt: parsed.createdAt
        });
      }
    }
    
    return new Response(JSON.stringify({ users }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to list users', { error: error.message });
    return errorResponse('Failed to list users', 'LIST_USERS_FAILED', 500);
  }
}

async function deleteUser(token, env) {
  try {
    const hashedToken = await hashToken(token);
    // Check if user exists
    const userData = await env.CITATION_VERIFIER_USERS.get(hashedToken);
    if (!userData) {
      return errorResponse('User not found', 'USER_NOT_FOUND', 404);
    }
    
    // Delete from KV
    await env.CITATION_VERIFIER_USERS.delete(hashedToken);
    
    logEvent('info', 'User deleted', { token: token.substring(0, 8) });
    
    return new Response(JSON.stringify({
      success: true,
      message: 'User deleted'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to delete user', { error: error.message });
    return errorResponse('Failed to delete user', 'DELETE_USER_FAILED', 500);
  }
}

function isAdmin(request, env) {
  const adminSecret = request.headers.get('X-Admin-Token');
  // A basic timing-safe comparison to prevent timing attacks.
  if (!adminSecret || !env.ADMIN_SECRET || adminSecret.length !== env.ADMIN_SECRET.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < adminSecret.length; ++i) {
    mismatch |= adminSecret.charCodeAt(i) ^ env.ADMIN_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

async function handleUsageReport(request, env) {
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'csv';
  // The admin check is now handled by the centralized router.

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
  // The admin check is now handled by the centralized router.

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

function errorResponse(message, code, status = 400, request, env) {
  return new Response(JSON.stringify({
    error: {
      message,
      code,
      timestamp: new Date().toISOString()
    }
  }), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) }
  });
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

class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failureCount = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
  }
  
  async call(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const error = new Error('Circuit breaker is OPEN - service temporarily unavailable');
        error.code = 'CIRCUIT_BREAKER_OPEN';
        throw error;
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      
      // ✅ ADD CONTEXT TO ERROR
      logEvent('error', 'Circuit breaker caught error', {
        errorMessage: error.message,
        state: this.state,
        failures: this.failureCount
      });
      
      throw error; // Re-throw with original error
    }
  }
  
  onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      logEvent('error', 'Circuit breaker OPEN for DeepSeek API');
    }
  }
}

const deepSeekCircuitBreaker = new CircuitBreaker();

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

async function callDeepSeek(messages, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    logEvent('info', 'Making DeepSeek API request', {
      hasApiKey: !!apiKey
    });
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        temperature: 0.7
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorBody = await response.text();
      logEvent('error', 'DeepSeek API error', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody
      });
      
      throw new Error(`DeepSeek API error: ${response.status} - ${response.statusText}`);
    }
    
    const data = await response.json();
    logEvent('info', 'DeepSeek API response received');
    
    return data.choices[0].message.content;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      throw new Error('DeepSeek API timeout after 30 seconds');
    }
    
    throw error;
  }
}

async function performAnalysis(text, apiKey) {
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
  \"explicitCitations\": [\n    {\"text\": \"citation as appears\", \"authors\": \"if identifiable\", \"year\": \"if identifiable\"}
  ],
    \"missingCitations\": [\"claim without proper citation\"],
    \"documentType\": \"full article or abstract or other\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT ABOVE. DO NOT ADD ANY EXPLANATORY TEXT.`;
  const extractResponse = await callDeepSeek([{ role: "user", content: extractPrompt }], apiKey);
  const extraction = parseJSON(extractResponse);

  // Step 2: Search
  const claimsToCheck = extraction.keyClaims.slice(0, 3);
  const searchResults = [];
  for (const claim of claimsToCheck) {
    const searchPrompt = `Assess the credibility and verifiability of this claim from an academic publication: \"${claim.claim}\"\n\n${claim.citationText ? `The claim cites: ${claim.citationText}` : 'No citation provided for this claim.'}\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"claim\": \"${claim.claim}\",\n  \"credibilityScore\": \"high or medium or low\",\n  \"supportingEvidence\": [\"brief point 1\", \"brief point 2\"],
  \"contradictingEvidence\": [\"brief point if found\"],
  \"retractionsFound\": false,\n  \"reasoning\": \"one sentence explanation\",
  \"citationStatus\": \"properly cited or missing citation or questionable citation\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT.`;
    const searchResponse = await callDeepSeek([{ role: "user", content: searchPrompt }], apiKey);
    const deepSeekResult = parseJSON(searchResponse);
    const semanticScholarResults = await querySemanticScholar(claim.claim);
    
    deepSeekResult.semanticScholar = semanticScholarResults;

    searchResults.push(deepSeekResult);
  }

  // Step 3: Review
  const reviewPrompt = `You are a critical peer reviewer. Review this academic text based on the analysis below.\n\nDocument Type: ${extraction.documentType}
Key Claims: ${JSON.stringify(extraction.keyClaims)}
Explicit Citations: ${JSON.stringify(extraction.explicitCitations)}
Missing Citations: ${JSON.stringify(extraction.missingCitations)}
Credibility Results: ${JSON.stringify(searchResults)}

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"overallAssessment\": \"high quality or medium quality or low quality\",\n  \"strengths\": [\"strength 1\", \"strength 2\"],
  \"weaknesses\": [\"weakness 1\", \"weakness 2\"],
  \"citationQuality\": \"one sentence assessment\",
  \"majorConcerns\": [\"concern 1\", \"concern 2\"],
  \"recommendations\": [\"recommendation 1\", \"recommendation 2\"],
  \"verdict\": \"accept or minor revisions or major revisions or reject\",
  \"documentTypeNote\": \"note about limitations if abstract only\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT BEFORE OR AFTER.`;
  const reviewResponse = await callDeepSeek([{ role: "user", content: reviewPrompt }], apiKey);
  const review = parseJSON(reviewResponse);

  return { analysis: { extraction, searchResults, review }, overallAssessment: review.overallAssessment };
}

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === 'DELETE') {
      await this.state.storage.delete('user');
      return new Response('Cache cleared');
    }

    let hashedToken; // Define here to be accessible in catch block
    try {
      const body = await request.json();
      hashedToken = body.hashedToken;
      const text = body.text;

      logEvent('info', 'Rate limiter DO received request', { hashedToken: hashedToken?.substring(0, 10), textLength: text?.length || 0 });

      // Always fetch the user from KV
      const user = await this.env.CITATION_VERIFIER_USERS.get(hashedToken, { type: 'json' });
      if (!user) {
        logEvent('warn', 'User not found in KV', { hashedToken: hashedToken?.substring(0, 10) });
        return errorResponse('Unauthorized: Invalid token', 'INVALID_TOKEN', 401, request, this.env);
      }

      if (user.analyses.length >= user.limit) {
        logEvent('warn', 'Usage limit exceeded for user', { hashedToken: hashedToken?.substring(0, 10), limit: user.limit });
        return errorResponse('Usage limit exceeded.', 'LIMIT_EXCEEDED', 429, request, this.env);
      }

      const { analysis, overallAssessment } = await performAnalysis(text, this.env.DEEPSEEK_API_KEY);
      const articleTitle = getArticleTitle(text);
      const wordCount = text.trim().split(/\s+/).length;
      
      user.analyses.push({ articleTitle, wordCount, overallAssessment, date: new Date().toISOString() });
      
      await this.env.CITATION_VERIFIER_USERS.put(hashedToken, JSON.stringify(user));
      
      logEvent('info', 'Analysis successful', { hashedToken: hashedToken?.substring(0, 10) });

      return new Response(JSON.stringify({ analysis }), {
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, this.env) },
      });
    } catch (error) {
      // ✅ ADD DETAILED LOGGING
      logEvent('error', 'Analysis failed in DO', {
        errorMessage: error.message,
        errorName: error.name,
        errorStack: error.stack,
        textLength: text.length
      });
      
      // ✅ RETURN PROPER ERROR MESSAGE
      return errorResponse(
        error.message || 'Analysis failed due to an unknown error',
        'ANALYSIS_FAILED',
        500
      );
    }
  }
}

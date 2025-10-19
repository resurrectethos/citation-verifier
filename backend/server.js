import TokenManager from './tokenManager.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCorsHeaders(request, env)
      });
    }
    
    try {
      // Admin routes
      if (url.pathname.startsWith('/admin/')) {
        const adminToken = request.headers.get('X-Admin-Token');
        if (adminToken !== env.ADMIN_SECRET) {
          return new Response(JSON.stringify({
            error: {
              message: 'Invalid admin credentials',
              code: 'FORBIDDEN'
            }
          }), {
            status: 403,
            headers: {
              'Content-Type': 'application/json',
              ...getCorsHeaders(request, env)
            }
          });
        }
        
        // POST /admin/users - Create user
        if (url.pathname === '/admin/users' && request.method === 'POST') {
          return await createUser(request, env);
        }
        
        // GET /admin/users - List all users
        if (url.pathname === '/admin/users' && request.method === 'GET') {
          return await listUsers(request, env);
        }
        
        // GET /admin/users/:token - Get single user
        if (url.pathname.match(/^\/admin\/users\/[^\/]+$/) && request.method === 'GET') {
          const token = url.pathname.split('/').pop();
          return await getUser(token, request, env);
        }
        
        // PUT /admin/users/:token - Update user
        if (url.pathname.match(/^\/admin\/users\/[^\/]+$/) && request.method === 'PUT') {
          const token = url.pathname.split('/').pop();
          return await updateUser(token, request, env);
        }
        
        // DELETE /admin/users/:token - Delete user
        if (url.pathname.match(/^\/admin\/users\/[^\/]+$/) && request.method === 'DELETE') {
          const token = url.pathname.split('/').pop();
          return await deleteUser(token, request, env);
        }
      }
      
      // Analysis endpoint
      if (url.pathname === '/' && request.method === 'POST') {
        // Validate token
        const validation = await validateToken(request, env);
        
        if (!validation.valid) {
          // Return the detailed error response
          const response = validation.error;
          response.headers.set(...Object.entries(getCorsHeaders(request, env)));
          return response;
        }
        
        // Forward to Durable Object
        const id = env.RATE_LIMITER.idFromName(validation.token);
        const stub = env.RATE_LIMITER.get(id);

        const doRequest = new Request(request.url, request);
        doRequest.headers.set('X-Worker-Token', validation.token);

        return await stub.fetch(doRequest);
      }
      
      // 404 for unknown routes
      return errorResponse('Not found', 'NOT_FOUND', 404, request, env);
      
    } catch (error) {
      logEvent('error', 'Request handler error', {
        error: error.message,
        stack: error.stack,
        path: url.pathname
      });
      
      return errorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500,
        request,
        env
      );
    }
  }
};

/**
 * Validate user token and return user data
 */
async function validateToken(request, env) {
  try {
    // Extract token from Authorization header
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader) {
      return {
        valid: false,
        error: errorResponse(
          'Missing Authorization header. Please include your access token.',
          'MISSING_TOKEN',
          401,
          request,
          env
        )
      };
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      return {
        valid: false,
        error: errorResponse(
          'Invalid Authorization format. Use: Bearer YOUR_TOKEN',
          'INVALID_AUTH_FORMAT',
          401,
          request,
          env
        )
      };
    }
    
    const token = authHeader.replace('Bearer ', '').trim();
    
    // Validate token format
    const formatCheck = TokenManager.isValidFormat(token);
    if (!formatCheck.valid) {
      return {
        valid: false,
        error: errorResponse(
          `Invalid token format: ${formatCheck.reason}`,
          'INVALID_TOKEN_FORMAT',
          401,
          request,
          env
        )
      };
    }
    
    // Get user from KV
    const userDataStr = await env.CITATION_VERIFIER_USERS.get(token);
    
    if (!userDataStr) {
      return {
        valid: false,
        error: errorResponse(
          'Token not found. Please check your access token or contact support.',
          'TOKEN_NOT_FOUND',
          401,
          request,
          env
        )
      };
    }
    
    const userData = JSON.parse(userDataStr);
    
    // Validate user status and limits
    const userCheck = TokenManager.validateUser(userData, token);
    if (!userCheck.valid) {
      return {
        valid: false,
        error: errorResponse(
          userCheck.reason,
          userCheck.code,
          userCheck.code === 'LIMIT_EXCEEDED' ? 429 : 403,
          request,
          env
        )
      };
    }
    
    return {
      valid: true,
      token,
      userData
    };
    
  } catch (error) {
    logEvent('error', 'Token validation failed', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      valid: false,
      error: errorResponse(
        'Token validation failed. Please try again.',
        'VALIDATION_ERROR',
        500,
        request,
        env
      )
    };
  }
}

/**
 * CREATE USER - POST /admin/users
 */
async function createUser(request, env) {
  try {
    const { email, limit = 5 } = await request.json();
    
    // Validate input
    if (!email || !email.includes('@')) {
      return errorResponse('Valid email is required', 'INVALID_EMAIL', 400, request, env);
    }
    
    if (limit < 1 || limit > 1000) {
      return errorResponse('Limit must be between 1 and 1000', 'INVALID_LIMIT', 400, request, env);
    }
    
    // Generate token
    const token = TokenManager.generateToken();
    
    // Create user object
    const userData = TokenManager.createUser(email, limit);
    
    // Store in KV
    await env.CITATION_VERIFIER_USERS.put(token, JSON.stringify(userData));
    
    // Log creation
    logEvent('info', 'User created', {
      email,
      token: token.substring(0, 20) + '...', 
      limit
    });
    
    // Return token to admin
    return new Response(JSON.stringify({
      success: true,
      token,
      email,
      limit,
      message: 'User created successfully'
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to create user', {
      error: error.message,
      stack: error.stack
    });
    return errorResponse(
      `Failed to create user: ${error.message}`,
      'CREATE_USER_FAILED',
      500,
      request,
      env
    );
  }
}

/**
 * LIST USERS - GET /admin/users
 */
async function listUsers(request, env) {
  try {
    const users = [];
    
    // Get all keys from KV
    let cursor = undefined;
    do {
      const list = await env.CITATION_VERIFIER_USERS.list({ cursor });
      
      for (const key of list.keys) {
        try {
          const userData = await env.CITATION_VERIFIER_USERS.get(key.name);
          if (userData) {
            const parsed = JSON.parse(userData);
            users.push({
              token: key.name,
              email: parsed.email,
              limit: parsed.limit,
              used: parsed.analyses?.length || 0,
              remaining: parsed.limit - (parsed.analyses?.length || 0),
              status: parsed.status || 'active',
              createdAt: parsed.createdAt,
              lastUsed: parsed.lastUsed
            });
          }
        } catch (e) {
          logEvent('warn', 'Failed to parse user data', {
            token: key.name.substring(0, 20),
            error: e.message
          });
        }
      }
      
      cursor = list.cursor;
    } while (cursor);
    
    // Sort by creation date (newest first)
    users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    return new Response(JSON.stringify({
      success: true,
      count: users.length,
      users
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to list users', {
      error: error.message,
      stack: error.stack
    });
    return errorResponse(
      `Failed to list users: ${error.message}`,
      'LIST_USERS_FAILED',
      500,
      request,
      env
    );
  }
}

/**
 * GET SINGLE USER - GET /admin/users/:token
 */
async function getUser(token, request, env) {
  try {
    // Validate token format
    const formatCheck = TokenManager.isValidFormat(token);
    if (!formatCheck.valid) {
      return errorResponse(formatCheck.reason, 'INVALID_TOKEN_FORMAT', 400, request, env);
    }
    
    // Get from KV
    const userData = await env.CITATION_VERIFIER_USERS.get(token);
    
    if (!userData) {
      return errorResponse('User not found', 'USER_NOT_FOUND', 404, request, env);
    }
    
    const parsed = JSON.parse(userData);
    
    return new Response(JSON.stringify({
      success: true,
      token,
      user: {
        email: parsed.email,
        limit: parsed.limit,
        used: parsed.analyses?.length || 0,
        remaining: parsed.limit - (parsed.analyses?.length || 0),
        status: parsed.status || 'active',
        createdAt: parsed.createdAt,
        lastUsed: parsed.lastUsed,
        analyses: parsed.analyses || []
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to get user', {
      token: token.substring(0, 20),
      error: error.message
    });
    return errorResponse(
      `Failed to get user: ${error.message}`,
      'GET_USER_FAILED',
      500,
      request,
      env
    );
  }
}

/**
 * UPDATE USER - PUT /admin/users/:token
 */
async function updateUser(token, request, env) {
  try {
    const { limit, status } = await request.json();
    
    // Get existing user
    const existing = await env.CITATION_VERIFIER_USERS.get(token);
    if (!existing) {
      return errorResponse('User not found', 'USER_NOT_FOUND', 404, request, env);
    }
    
    const userData = JSON.parse(existing);
    
    // Update fields
    if (limit !== undefined) {
      if (limit < 1 || limit > 1000) {
        return errorResponse('Limit must be between 1 and 1000', 'INVALID_LIMIT', 400, request, env);
      }
      userData.limit = limit;
    }
    
    if (status !== undefined) {
      if (!['active', 'suspended', 'expired'].includes(status)) {
        return errorResponse('Invalid status', 'INVALID_STATUS', 400, request, env);
      }
      userData.status = status;
    }
    
    userData.updatedAt = new Date().toISOString();
    
    // Save back to KV
    await env.CITATION_VERIFIER_USERS.put(token, JSON.stringify(userData));
    
    logEvent('info', 'User updated', {
      token: token.substring(0, 20),
      changes: { limit, status }
    });
    
    return new Response(JSON.stringify({
      success: true,
      message: 'User updated successfully',
      user: userData
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to update user', {
      token: token.substring(0, 20),
      error: error.message
    });
    return errorResponse(
      `Failed to update user: ${error.message}`,
      'UPDATE_USER_FAILED',
      500,
      request,
      env
    );
  }
}

/**
 * DELETE USER - DELETE /admin/users/:token
 */
async function deleteUser(token, request, env) {
  try {
    // Check if exists
    const existing = await env.CITATION_VERIFIER_USERS.get(token);
    if (!existing) {
      return errorResponse('User not found', 'USER_NOT_FOUND', 404, request, env);
    }
    
    // Delete from KV
    await env.CITATION_VERIFIER_USERS.delete(token);
    
    logEvent('info', 'User deleted', {
      token: token.substring(0, 20)
    });
    
    return new Response(JSON.stringify({
      success: true,
      message: 'User deleted successfully'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    logEvent('error', 'Failed to delete user', {
      token: token.substring(0, 20),
      error: error.message
    });
    return errorResponse(
      `Failed to delete user: ${error.message}`,
      'DELETE_USER_FAILED',
      500,
      request,
      env
    );
  }
}

function getArticleTitle(text) {
  const firstNLines = text.split('\n').slice(0, 10).join('\n');
  const potentialTitles = firstNLines.split('\n').filter(line => line.trim().length > 0 && line.split(' ').length > 3 && !line.toLowerCase().includes('abstract'));
  return potentialTitles.length > 0 ? potentialTitles[0].trim() : 'Untitled';
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
      'Access-Control-Allow-Methods': 'POST, GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    };
  }

  // Return minimal headers if origin is not allowed
  return { 'Vary': 'Origin' };
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
  const extractPrompt = `Analyze this academic text and extract key claims and citations.\n\nText: \"${text}\"\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT BEFORE OR AFTER THE JSON.\n\nFormat:\n{\n  \"keyClaims\": [\n    {\"claim\": \"text of claim\", \"requiresCitation\": true, \"hasCitation\": false, \"citationText\": \"author year or empty\"}
  ],
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
    const searchPrompt = `Assess the credibility and verifiability of this claim from an academic publication: \"${claim.claim}\"\n\n${claim.citationText ? `The claim cites: ${claim.citationText}` : 'No citation provided for this claim.'}\n\nYOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.\n\nFormat:\n{\n  \"claim\": \"${claim.claim}\",
  \"credibilityScore\": \"high or medium or low\",
  \"supportingEvidence\": [\"brief point 1\", \"brief point 2\"],
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
  \"verdict\": \"accept or minor revisions or major revisions or reject\",\n  \"documentTypeNote\": \"note about limitations if abstract only\"\n}\n\nRESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT BEFORE OR AFTER.`;
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

    const token = request.headers.get('X-Worker-Token');
    try {
      const body = await request.json();
      const text = body.text;

      logEvent('info', 'Rate limiter DO received request', { token: token?.substring(0, 20), textLength: text?.length || 0 });

      // Always fetch the user from KV
      const user = await this.env.CITATION_VERIFIER_USERS.get(token, { type: 'json' });
      if (!user) {
        logEvent('warn', 'User not found in KV', { token: token?.substring(0, 20) });
        return errorResponse('Unauthorized: Invalid token', 'INVALID_TOKEN', 401, request, this.env);
      }

      if (user.analyses.length >= user.limit) {
        logEvent('warn', 'Usage limit exceeded for user', { token: token?.substring(0, 20), limit: user.limit });
        return errorResponse('Usage limit exceeded.', 'LIMIT_EXCEEDED', 429, request, this.env);
      }

      const { analysis, overallAssessment } = await performAnalysis(text, this.env.DEEPSEEK_API_KEY);
      const articleTitle = getArticleTitle(text);
      const wordCount = text.trim().split(/\s+/).length;
      
      user.analyses.push({ articleTitle, wordCount, overallAssessment, date: new Date().toISOString() });
      user.lastUsed = new Date().toISOString();
      
      await this.env.CITATION_VERIFIER_USERS.put(token, JSON.stringify(user));
      
      logEvent('info', 'Analysis successful', { token: token?.substring(0, 20) });

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
        500,
        request,
        this.env
      );
    }
  }
}
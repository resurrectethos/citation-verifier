import React, { useState } from 'react';
import { Search, AlertCircle, CheckCircle, XCircle, Loader2, FileText, Upload, Info, Download } from 'lucide-react';

export default function CitationVerifier() {
  const [text, setText] = useState(`Recent years have seen a global growth in developing Artificial Intelligence/Machine learning/social robots for healthcare. Japan invests over 30% of its GDP on social robotics to make up for the lack of care workers. `);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [fileName, setFileName] = useState('');
  const [apiKey, setApiKey] = useState(''); // Add API key input

  const parseJSON = (text) => {
    let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.substring(start, end + 1);
    }
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('JSON parsing error:', err);
      throw new Error('Failed to parse AI response');
    }
  };

  // DeepSeek API call function
  const callDeepSeek = async (messages, maxTokens = 4000) => {
    if (!apiKey) {
      throw new Error('DeepSeek API key is required');
    }

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

    if (!response.ok) {
      throw new Error(`DeepSeek API request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setProgress('Reading file...');

    try {
      if (file.type === 'application/pdf') {
        // For PDF files, we'll extract text using a client-side approach
        setProgress('Extracting text from PDF...');
        
        // Note: For production, you might want to use a proper PDF extraction library
        // This is a simplified version - you may need to implement proper PDF text extraction
        const textContent = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            // Simple text extraction - for actual PDFs, consider using pdf.js or similar
            resolve("PDF text extraction would go here. For now, please paste text directly or use TXT files.");
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsText(file);
        });
        
        setText(textContent);
        setProgress('');
      } else if (file.type === 'text/plain') {
        const textContent = await file.text();
        setText(textContent);
        setProgress('');
      } else {
        throw new Error('Unsupported file type. Please upload PDF or TXT files.');
      }
    } catch (err) {
      console.error("File upload error:", err);
      setError(`File upload failed: ${err.message}`);
      setProgress('');
      setFileName('');
    }
  };

  const analyzeText = async () => {
    if (!apiKey) {
      setError('Please enter your DeepSeek API key');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);
    setProgress('Analyzing publication and extracting claims...');

    try {
      // Step 1: Extract claims and citations
      const extractPrompt = `Analyze this academic text and extract key claims and citations.

Text: "${text}"

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT BEFORE OR AFTER THE JSON.

Format:
{
  "keyClaims": [
    {"claim": "text of claim", "requiresCitation": true, "hasCitation": false, "citationText": "author year or empty"}
  ],
  "explicitCitations": [
    {"text": "citation as appears", "authors": "if identifiable", "year": "if identifiable"}
  ],
  "missingCitations": ["claim without proper citation"],
  "documentType": "full article or abstract or other"
}

RESPOND ONLY WITH THE JSON OBJECT ABOVE. DO NOT ADD ANY EXPLANATORY TEXT.`;

      const extractResponse = await callDeepSeek([
        { role: "user", content: extractPrompt }
      ], 3000);

      const extraction = parseJSON(extractResponse);

      setProgress('Verifying citations and checking credibility...');

      // Step 2: Verify claims (limit to 3 for performance)
      const claimsToCheck = extraction.keyClaims.slice(0, 3);
      const searchResults = [];

      for (const claim of claimsToCheck) {
        try {
          const searchPrompt = `Assess the credibility and verifiability of this claim from an academic publication: "${claim.claim}"

${claim.citationText ? `The claim cites: ${claim.citationText}` : 'No citation provided for this claim.'}

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.

Format:
{
  "claim": "${claim.claim}",
  "credibilityScore": "high or medium or low",
  "supportingEvidence": ["brief point 1", "brief point 2"],
  "contradictingEvidence": ["brief point if found"],
  "retractionsFound": false,
  "reasoning": "one sentence explanation",
  "citationStatus": "properly cited or missing citation or questionable citation"
}

RESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT.`;

          const searchResponse = await callDeepSeek([
            { role: "user", content: searchPrompt }
          ], 1500);

          const result = parseJSON(searchResponse);
          searchResults.push(result);
        } catch (err) {
          console.error("Search error for claim:", err);
          searchResults.push({
            claim: claim.claim,
            credibilityScore: "unknown",
            reasoning: "Unable to verify due to API error"
          });
        }
      }

      setProgress('Generating comprehensive peer review...');

      // Step 3: Generate peer review
      const reviewPrompt = `You are a critical peer reviewer. Review this academic text based on the analysis below.

Document Type: ${extraction.documentType}
Key Claims: ${JSON.stringify(extraction.keyClaims)}
Explicit Citations: ${JSON.stringify(extraction.explicitCitations)}
Missing Citations: ${JSON.stringify(extraction.missingCitations)}
Credibility Results: ${JSON.stringify(searchResults)}

YOU MUST RESPOND WITH ONLY A VALID JSON OBJECT. NO OTHER TEXT.

Format:
{
  "overallAssessment": "high quality or medium quality or low quality",
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "citationQuality": "one sentence assessment",
  "majorConcerns": ["concern 1", "concern 2"],
  "recommendations": ["recommendation 1", "recommendation 2"],
  "verdict": "accept or minor revisions or major revisions or reject",
  "documentTypeNote": "note about limitations if abstract only"
}

RESPOND ONLY WITH THE JSON OBJECT. NO ADDITIONAL TEXT BEFORE OR AFTER.`;

      const reviewResponse = await callDeepSeek([
        { role: "user", content: reviewPrompt }
      ], 2500);

      const review = parseJSON(reviewResponse);

      setAnalysis({
        extraction,
        searchResults,
        review
      });
      setProgress('');
    } catch (err) {
      console.error("Analysis error:", err);
      setError(`Analysis failed: ${err.message}. Please check your API key and try again.`);
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  // The rest of your helper functions and JSX remain the same...
  const getScoreColor = (score) => {
    if (score === 'high') return 'text-green-600';
    if (score === 'medium') return 'text-yellow-600';
    if (score === 'low') return 'text-red-600';
    return 'text-gray-600';
  };

  const getVerdictColor = (verdict) => {
    if (verdict?.includes('accept')) return 'bg-green-100 text-green-800';
    if (verdict?.includes('minor')) return 'bg-blue-100 text-blue-800';
    if (verdict?.includes('major')) return 'bg-yellow-100 text-yellow-800';
    if (verdict?.includes('reject')) return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-800';
  };

  const getCitationStatusColor = (status) => {
    if (status?.includes('properly')) return 'text-green-600';
    if (status?.includes('missing')) return 'text-red-600';
    if (status?.includes('questionable')) return 'text-orange-600';
    return 'text-gray-600';
  };

  const downloadReview = () => {
    // ... (keep the same downloadReview function)
    if (!analysis) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'publication';
    
    let markdown = `# Publication Citation Verification Report\n\n`;
    markdown += `**Generated:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
    markdown += `**Document:** ${fileName || 'Pasted text'}\n\n`;
    
    if (analysis.extraction.documentType) {
      markdown += `**Document Type:** ${analysis.extraction.documentType}\n\n`;
    }
    
    markdown += `---\n\n`;
    
    // ... rest of markdown generation (same as original)
    
    // Create and download file
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_review_${timestamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-8 h-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-gray-800">Publication Citation Verifier</h1>
          </div>
          
          <p className="text-gray-600 mb-4">
            AI-powered critical peer review tool that analyzes academic publications, verifies citations, and checks credibility.
          </p>

          {/* API Key Input */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              DeepSeek API Key *
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your DeepSeek API key"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-sm text-gray-500 mt-1">
              Your API key is required for analysis and is not stored anywhere.
            </p>
          </div>

          {/* ... rest of your JSX remains the same ... */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-900">
                <p className="font-semibold mb-2">Best Results with Full Articles</p>
                <ul className="list-disc list-inside space-y-1 text-blue-800">
                  <li><strong>Full articles with references</strong> - Most comprehensive analysis</li>
                  <li><strong>Editorials or essays with citations</strong> - Good for verification</li>
                  <li><strong>Abstracts alone</strong> - Limited (most lack citations)</li>
                </ul>
                <p className="mt-2">Upload a PDF or paste the full text for best results.</p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Upload Publication (PDF or TXT)
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 cursor-pointer transition">
                <Upload className="w-5 h-5" />
                <span>Choose File</span>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              {fileName && (
                <span className="text-sm text-gray-600">
                  📄 {fileName}
                </span>
              )}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Or Paste Text Here
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
              placeholder="Paste the full article text, editorial, or abstract here..."
            />
          </div>

          <button
            onClick={analyzeText}
            disabled={loading || !text.trim() || !apiKey}
            className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                Analyze & Verify Citations
              </>
            )}
          </button>

          {progress && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress}
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                {error}
              </p>
            </div>
          )}
        </div>

        {analysis && (
          <div className="space-y-6">
            {/* Download Button */}
            <div className="bg-white rounded-lg shadow-xl p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Export Review Report</h3>
                  <p className="text-sm text-gray-600">Download a comprehensive markdown report of this analysis</p>
                </div>
                <button
                  onClick={downloadReview}
                  className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
                >
                  <Download className="w-5 h-5" />
                  Download Review
                </button>
              </div>
            </div>

            {/* ... rest of your analysis display JSX remains the same ... */}
          </div>
        )}
      </div>
    </div>
  );
}

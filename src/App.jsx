import React, { useState, useEffect, Suspense } from 'react';
import { Search, AlertCircle, CheckCircle, XCircle, Loader2, FileText, Upload, Info, Download, Sun, Moon } from 'lucide-react';

const CitationVerifier = () => {
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [fileName, setFileName] = useState('');
  const [userToken, setUserToken] = useState(''); // New state for user token
  const [darkMode, setDarkMode] = useState(localStorage.getItem('darkMode') === 'true');
  const [wordCount, setWordCount] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showReviewDropdown, setShowReviewDropdown] = useState(false);

  useEffect(() => {
    setIsAdmin(userToken === 'admin-secret-token');
  }, [userToken]);

  useEffect(() => {
    const words = text.trim().split(/\s+/);
    const wordCount = text.trim() === '' ? 0 : words.length;
    setWordCount(wordCount);
    setTokenCount(Math.ceil(text.length / 4));
  }, [text]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('darkMode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('darkMode', 'false');
    }
  }, [darkMode]);

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

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setProgress('Reading file...');

    try {
      if (file.type === 'application/pdf') {
        setProgress('Extracting text from PDF...');
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const pdfjs = await import('pdfjs-dist/build/pdf');
            pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs`;
            const typedarray = new Uint8Array(e.target.result);
            const pdf = await pdfjs.getDocument(typedarray).promise;
            let content = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              content += textContent.items.map(item => item.str).join(' ');
            }
            setText(content);
            setProgress('');
          } catch (err) {
            console.error("PDF parsing error:", err);
            setError(`Failed to parse PDF: ${err.message}`);
            setProgress('');
          }
        };
        reader.readAsArrayBuffer(file);
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
    if (!userToken) {
      setError('Please enter your access token');
      return;
    }

    setLoading(true);
    setError(null);
    setAnalysis(null);
    setProgress('Analyzing publication and extracting claims...');

    try {
      const response = await fetch('https://citation-verifier-backend.preggyr.workers.dev', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: userToken, text: text }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const data = await response.json();
      setAnalysis(data.analysis);
      setProgress('');
    } catch (err) {
      console.error("Analysis error:", err);
      setError(`Analysis failed: ${err.message}.`);
      setProgress('');
    } finally {
      setLoading(false);
    }
  };

  // The rest of your helper functions and JSX remain the same...
  const getScoreColor = (score) => {
    if (score === 'high') return 'text-green-400';
    if (score === 'medium') return 'text-yellow-400';
    if (score === 'low') return 'text-red-400';
    return 'text-gray-400';
  };

  const getVerdictColor = (verdict) => {
    if (verdict?.includes('accept')) return 'bg-green-900 text-green-100';
    if (verdict?.includes('minor')) return 'bg-blue-900 text-blue-100';
    if (verdict?.includes('major')) return 'bg-yellow-900 text-yellow-100';
    if (verdict?.includes('reject')) return 'bg-red-900 text-red-100';
    return 'bg-gray-700 text-gray-100';
  };

  const getCitationStatusColor = (status) => {
    if (status?.includes('properly')) return 'text-green-400';
    if (status?.includes('missing')) return 'text-red-400';
    if (status?.includes('questionable')) return 'text-orange-400';
    return 'text-gray-400';
  };

  const downloadReview = async (format) => {
    if (!analysis) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = fileName ? fileName.replace(/\.[^/.]+$/, '') : 'publication';

    let content;
    let blobType;
    let fileExtension;

    const generateMarkdown = () => {
      let markdown = `# Publication Citation Verification Report\n\n`;
      markdown += `**Generated:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`;
      markdown += `**Document:** ${fileName || 'Pasted text'}\n\n`;
      if (analysis.extraction.documentType) {
        markdown += `**Document Type:** ${analysis.extraction.documentType}\n\n`;
      }
      markdown += `---\n\n## Peer Review Verdict\n\n`;
      markdown += `**Verdict:** ${analysis.review.verdict}\n`;
      markdown += `**Overall Assessment:** ${analysis.review.overallAssessment}\n`;
      markdown += `**Citation Quality:** ${analysis.review.citationQuality}\n\n`;
      markdown += `### Strengths\n`;
      analysis.review.strengths.forEach(s => markdown += `- ${s}\n`);
      markdown += `\n### Weaknesses\n`;
      analysis.review.weaknesses.forEach(w => markdown += `- ${w}\n`);
      markdown += `\n### Major Concerns\n`;
      analysis.review.majorConcerns.forEach(c => markdown += `- ${c}\n`);
      markdown += `\n### Recommendations\n`;
      analysis.review.recommendations.forEach(r => markdown += `- ${r}\n`);
      if (analysis.review.documentTypeNote) {
        markdown += `\n**Note on Document Type:** ${analysis.review.documentTypeNote}\n`;
      }
      markdown += `\n---\n\n## Detailed Claim Verification\n\n`;
      analysis.searchResults.forEach(result => {
        markdown += `### Claim: "${result.claim}"\n`;
        markdown += `- **Credibility Score:** ${result.credibilityScore}\n`;
        markdown += `- **Citation Status:** ${result.citationStatus}\n`;
        markdown += `- **Reasoning:** ${result.reasoning}\n`;
        if (result.supportingEvidence?.length > 0) {
          markdown += `- **Supporting Evidence:**\n`;
          result.supportingEvidence.forEach(e => markdown += `  - ${e}\n`);
        }
        if (result.contradictingEvidence?.length > 0) {
          markdown += `- **Contradicting Evidence:**\n`;
          result.contradictingEvidence.forEach(e => markdown += `  - ${e}\n`);
        }
        markdown += `\n`;
      });
      markdown += `\n---\n\n## Extracted Data\n\n`;
      markdown += `### Key Claims Extracted\n`;
      analysis.extraction.keyClaims.forEach(c => {
        markdown += `- **Claim:** ${c.claim}\n`;
        markdown += `  - **Requires Citation:** ${c.requiresCitation}\n`;
        markdown += `  - **Has Citation:** ${c.hasCitation}\n`;
        markdown += `  - **Cited As:** ${c.citationText || 'N/A'}\n`;
      });
      markdown += `\n### Explicit Citations Found\n`;
      analysis.extraction.explicitCitations.forEach(c => markdown += `- ${c.text}\n`);
      markdown += `\n### Claims Missing Citations\n`;
      analysis.extraction.missingCitations.forEach(c => markdown += `- ${c}\n`);
      return markdown;
    };

    if (format === 'pdf') {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = 10;
      const margin = 50;
      let y = height - margin;

      const drawText = (text, font, size, x, y) => {
        page.drawText(text, { x, y, font, size, color: rgb(0, 0, 0) });
        return y - size * 1.5;
      };

      y = drawText('Publication Citation Verification Report', boldFont, 18, margin, y);
      y -= 20;

      const markdown = generateMarkdown();
      const lines = markdown.split('\n');

      for (const line of lines) {
        if (y < margin) {
          page = pdfDoc.addPage();
          y = height - margin;
        }
        if (line.startsWith('#')) {
          const level = line.match(/#/g).length;
          y = drawText(line.replace(/#/g, '').trim(), boldFont, 18 - level * 2, margin, y);
        } else if (line.startsWith('-')) {
          y = drawText(line, font, fontSize, margin + 10, y);
        } else {
          y = drawText(line, font, fontSize, margin, y);
        }
      }

      content = await pdfDoc.save();
      blobType = 'application/pdf';
      fileExtension = 'pdf';
    } else if (format === 'txt') {
      content = generateMarkdown().replace(/#+\s/g, '').replace(/\*\*/g, '');
      blobType = 'text/plain';
      fileExtension = 'txt';
    } else {
      content = generateMarkdown();
      blobType = 'text/markdown';
      fileExtension = 'md';
    }

    const blob = new Blob([content], { type: blobType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_review_${timestamp}.${fileExtension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadUsageReport = async (format) => {
    try {
      const response = await fetch(`https://citation-verifier-backend.preggyr.workers.dev/admin/usage-report?token=${userToken}&format=${format}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usage-report.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Failed to download usage report: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-base-100 text-gray-900 dark:text-base-content p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center py-8">
          <div className="text-left">
            <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 dark:text-white">Citation Verifier</h1>
            <p className="mt-4 text-lg text-gray-600 dark:text-neutral-content">An AI-powered tool to analyze academic publications, verify citations, and check credibility.</p>
          </div>
          <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full bg-gray-200 dark:bg-base-300 text-gray-800 dark:text-white">
            {darkMode ? <Sun /> : <Moon />}
          </button>
        </header>

        <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8 mb-8">
          <div className="flex items-center gap-4 mb-6">
            <FileText className="w-10 h-10 text-primary" />
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Submit Your Publication</h2>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-neutral-content mb-2">Your Access Token *</label>
            <input
              type="password"
              value={userToken}
              onChange={(e) => setUserToken(e.target.value)}
              placeholder="Enter your access token"
              className="w-full p-3 bg-gray-100 dark:bg-base-300 border border-gray-300 dark:border-base-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
            />
            <p className="text-sm text-gray-500 dark:text-neutral-content mt-1">Your access token is required for analysis.</p>
          </div>

          <div className="bg-indigo-50 dark:bg-primary/10 border border-indigo-200 dark:border-primary/20 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <Info className="w-6 h-6 text-primary mt-0.5 flex-shrink-0" />
              <div className="text-sm text-indigo-900 dark:text-primary">
                <p className="font-semibold mb-2">For Best Results</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><strong>Full articles with references</strong> for the most comprehensive analysis.</li>
                  <li><strong>Editorials or essays with citations</strong> for good verification.</li>
                  <li><strong>Abstracts alone</strong> provide limited analysis as they often lack citations.</li>
                </ul>
                <p className="mt-2">Upload a PDF/TXT or paste the full text for best results.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-neutral-content mb-2">Upload Publication (PDF or TXT)</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 cursor-pointer transition">
                  <Upload className="w-5 h-5" />
                  <span>Choose File</span>
                  <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} className="hidden" />
                </label>
                {fileName && <span className="text-sm text-gray-600 dark:text-neutral-content">📄 {fileName}</span>}
              </div>
            </div>
            <div className="md:text-right">
                <label className="block text-sm font-semibold text-gray-700 dark:text-neutral-content mb-2">Clear Input</label>
                <button onClick={() => setText('')} className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900/70 cursor-pointer transition">Clear Text</button>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 dark:text-neutral-content mb-2">Or Paste Text Here</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full h-64 p-4 bg-gray-100 dark:bg-base-300 border border-gray-300 dark:border-base-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent font-mono text-sm"
              placeholder="Paste the full article text, editorial, or abstract here..."
            />
            <div className="text-sm text-gray-500 dark:text-neutral-content mt-2 flex justify-between">
              <span>Word Count: {wordCount}</span>
              <span>Token Estimate: {tokenCount}</span>
            </div>
            {wordCount > 8500 && (
              <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-900/70 rounded-lg">
                <p className="text-red-800 dark:text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Word count exceeds 8500 words. Please shorten the text.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={analyzeText}
            disabled={loading || !text.trim() || !userToken || wordCount > 8500}
            className="w-full bg-primary text-black py-3 px-6 rounded-lg font-semibold hover:bg-primary/90 disabled:bg-gray-400 dark:disabled:bg-base-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-transform duration-200 transform hover:scale-105"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing...</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                <span>Analyze & Verify Citations</span>
              </>
            )}
          </button>

          {progress && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/50 border border-blue-200 dark:border-blue-900/70 rounded-lg">
              <p className="text-blue-800 dark:text-blue-300 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {progress}
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/50 border border-red-200 dark:border-red-900/70 rounded-lg">
              <p className="text-red-800 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                {error}
              </p>
            </div>
          )}
        </div>

        {analysis && (
          <div className="space-y-8">
            <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-gray-800 dark:text-white">Export Review Report</h3>
                  <p className="text-gray-600 dark:text-neutral-content">Download a comprehensive markdown report of this analysis.</p>
                </div>
                <div className="flex gap-4">
                  <div className="relative inline-block text-left" onMouseEnter={() => setShowReviewDropdown(true)} onMouseLeave={() => setShowReviewDropdown(false)}>
                    <div>
                      <button type="button" className="flex items-center gap-2 px-6 py-3 bg-green-600 text-black rounded-lg font-semibold hover:bg-green-700 transition-transform duration-200 transform hover:scale-105">
                        <Download className="w-5 h-5" />
                        <span>Download Review</span>
                      </button>
                    </div>
                    {showReviewDropdown && (
                      <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-base-300 ring-1 ring-black ring-opacity-5 z-10">
                        <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
                          <a href="#" onClick={() => downloadReview('md')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">Markdown (.md)</a>
                          <a href="#" onClick={() => downloadReview('txt')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">Text (.txt)</a>
                          <a href="#" onClick={() => downloadReview('pdf')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">PDF (.pdf)</a>
                        </div>
                      </div>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="relative inline-block text-left" onMouseEnter={() => setShowDropdown(true)} onMouseLeave={() => setShowDropdown(false)}>
                      <div>
                        <button type="button" className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-transform duration-200 transform hover:scale-105">
                          <Download className="w-5 h-5" />
                          <span>Download Usage Report</span>
                        </button>
                      </div>
                      {showDropdown && (
                        <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white dark:bg-base-300 ring-1 ring-black ring-opacity-5 z-10">
                          <div className="py-1" role="menu" aria-orientation="vertical" aria-labelledby="options-menu">
                            <a href="#" onClick={() => downloadUsageReport('csv')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">CSV</a>
                            <a href="#" onClick={() => downloadUsageReport('html')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">HTML</a>
                            <a href="#" onClick={() => downloadUsageReport('pdf')} className="block px-4 py-2 text-sm text-gray-700 dark:text-neutral-content hover:bg-gray-100 dark:hover:bg-base-100" role="menuitem">PDF</a>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
              <h2 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">Peer Review Verdict</h2>
              <div className={`flex items-center justify-between p-6 rounded-lg mb-4 ${getVerdictColor(analysis.review.verdict)}`}>
                <span className="font-semibold text-2xl">{analysis.review.verdict}</span>
                <div className="text-right">
                  <p><strong>Overall Assessment:</strong> {analysis.review.overallAssessment}</p>
                  <p><strong>Citation Quality:</strong> {analysis.review.citationQuality}</p>
                </div>
              </div>
              {analysis.review.documentTypeNote && (
                <div className="bg-yellow-50 dark:bg-yellow-900/50 border border-yellow-200 dark:border-yellow-900/70 rounded-lg p-4 text-sm text-yellow-900 dark:text-yellow-300">
                  <p><strong>Note:</strong> {analysis.review.documentTypeNote}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Strengths</h3>
                <ul className="space-y-3">
                  {analysis.review.strengths.map((item, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <CheckCircle className="w-6 h-6 text-green-500 mt-1 flex-shrink-0" />
                      <span className="text-gray-700 dark:text-neutral-content">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
                <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Weaknesses</h3>
                <ul className="space-y-3">
                  {analysis.review.weaknesses.map((item, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <XCircle className="w-6 h-6 text-red-500 mt-1 flex-shrink-0" />
                      <span className="text-gray-700 dark:text-neutral-content">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Major Concerns</h3>
              <ul className="space-y-3 mb-6">
                {analysis.review.majorConcerns.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-yellow-500 mt-1 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-neutral-content">{item}</span>
                  </li>
                ))}
              </ul>
              <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Recommendations</h3>
              <ul className="space-y-3">
                {analysis.review.recommendations.map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Info className="w-6 h-6 text-blue-500 mt-1 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-neutral-content">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white dark:bg-base-200 rounded-2xl shadow-2xl p-6 sm:p-8">
              <h2 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">Detailed Claim Verification</h2>
              <div className="space-y-6">
                {analysis.searchResults.map((result, index) => (
                  <div key={index} className="border border-gray-200 dark:border-base-300 rounded-lg p-4">
                    <p className="font-semibold text-gray-800 dark:text-white mb-3 text-lg">"{result.claim}"</p>
                    <div className="flex justify-between items-center">
                        <p className={`font-bold text-lg ${getScoreColor(result.credibilityScore)}`}>Credibility: {result.credibilityScore}</p>
                        <p className={`font-semibold text-lg ${getCitationStatusColor(result.citationStatus)}`}>Citation: {result.citationStatus}</p>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-neutral-content mt-2">{result.reasoning}</p>
                    {result.retractionsFound && <p className="text-sm font-bold text-red-600 dark:text-red-400 mt-2">Retractions Found</p>}
                    
                    {result.semanticScholar && result.semanticScholar.length > 0 && (
                      <div className="mt-4 border-t border-gray-200 dark:border-base-300 pt-4">
                        <h4 className="font-semibold text-md text-gray-700 dark:text-neutral-content mb-2">Semantic Scholar Results:</h4>
                        <ul className="space-y-2">
                          {result.semanticScholar.map(paper => (
                            <li key={paper.paperId}>
                              <a href={`https://www.semanticscholar.org/paper/${paper.paperId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm">
                                {paper.title}
                              </a>
                              <p className="text-xs text-gray-500 dark:text-neutral-content mt-1">
                                {paper.authors.map(a => a.name).join(', ')} ({paper.year}) - {paper.citationCount} citations
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CitationVerifier />
    </Suspense>
  )
}

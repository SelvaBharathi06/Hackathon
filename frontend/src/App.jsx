import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const SAMPLE_JSON = JSON.stringify(
  {
    endpoint: '/users',
    method: 'POST',
    fields: {
      email: 'string',
      age: 'number',
    },
  },
  null,
  2
);

const SAMPLE_STORY = `As a user, I want to see a dashboard with a left navigation menu, summary cards, and a CTA button to create a new report.

The dashboard should:
- Show a navigation sidebar with links to Home, Reports, Settings
- Display summary cards for total users, active sessions, and revenue
- Have a "Create Report" CTA button that opens a modal form
- Support a feature flag to enable/disable the analytics widget
- Show loading skeleton while data is being fetched
- Handle error states gracefully with a retry option
- Be responsive on mobile and tablet devices`;

const BASE_URL = 'http://localhost:4000';

const JSON_API_URL = `${BASE_URL}/generate-tests`;
const TEXT_API_URL = `${BASE_URL}/generate-from-text`;
const FILE_API_URL = `${BASE_URL}/generate-from-file`;
const SWAGGER_API_URL = `${BASE_URL}/generate-from-swagger-url`;
const DOWNLOAD_URL = `${BASE_URL}/download`;
const HEALTH_URL = `${BASE_URL}/health`;

const ACCEPTED_FILE_TYPES = '.txt,.pdf,.docx';

const CATEGORY_LABELS = {
  all: 'All',
  'Happy Path': 'Happy Path',
  'Negative': 'Negative',
  'Edge Case': 'Edge Case',
  'Adhoc': 'Adhoc',
};

const CAT_CSS_MAP = {
  'Happy Path': 'happy',
  'Negative': 'negative',
  'Edge Case': 'edge',
  'Adhoc': 'adhoc',
};

function catClass(category) {
  return CAT_CSS_MAP[category] || 'edge';
}

function getDisplayPriority(priority, category) {
  const p = (priority || '').toLowerCase();
  if (category === 'Happy Path') return 'Show Stopper';
  if (category === 'Negative') return 'Highest';
  if (category === 'Conditional' || p === 'high') return 'High';
  if (category === 'Edge Case' || p === 'medium') return 'Medium';
  return 'Low';
}

const PRIORITY_OPTIONS = ['ALL', 'Show Stopper', 'Highest', 'High', 'Medium', 'Low'];

const PRIORITY_CSS_MAP = {
  'Show Stopper': 'show-stopper',
  'Highest': 'highest',
  'High': 'high',
  'Medium': 'medium',
  'Low': 'low',
};

export default function App() {
  const [inputMode, setInputMode] = useState('json');
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [storyInput, setStoryInput] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [extractedPreview, setExtractedPreview] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);
  const [testCases, setTestCases] = useState([]);
  const [junitCode, setJunitCode] = useState('');
  const [summary, setSummary] = useState(null);
  const [detectedFeatures, setDetectedFeatures] = useState([]);
  const [parsingSource, setParsingSource] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('table');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [enhanceAI, setEnhanceAI] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [aiWarning, setAiWarning] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [inputType, setInputType] = useState('json');
  const [swaggerUrl, setSwaggerUrl] = useState('');

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }
  }, [toast]);

  useEffect(() => {
    if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }
  }, [copied]);

  function resetResults() {
    setError(''); setTestCases([]); setJunitCode(''); setSummary(null);
    setCategoryFilter('all'); setPriorityFilter('ALL'); setToast(null); setAiWarning('');
    setDetectedFeatures([]); setParsingSource(''); setExpandedRows(new Set());
    setExtractedPreview(''); setFileName('');
  }

  function resetFileInput() {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleGenerate() {
    resetResults();
    if (inputMode === 'json') {
      if (inputType === 'swagger') await generateFromSwagger();
      else await generateFromJSON();
    }
    else if (inputMode === 'story') await generateFromStory();
    else if (inputMode === 'file') await generateFromFile();
  }

  async function generateFromJSON() {
    if (!jsonInput.trim()) { setError('Please paste API JSON input.'); return; }
    let parsed;
    try { parsed = JSON.parse(jsonInput); } catch { setError('Invalid JSON.'); return; }
    if (enhanceAI) parsed.enhanceWithAI = true;

    setLoading(true);
    try {
      const res = await fetch(JSON_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Server error.'); return; }
      applyResults(data);
    } catch (err) { setError(`Could not reach the server: ${err.message}. Is the backend running on port 4000?`); }
    finally { setLoading(false); }
  }

  async function generateFromSwagger() {
    const trimmed = swaggerUrl.trim();
    if (!trimmed) { setError('Please paste a Swagger / OpenAPI URL.'); return; }
    try { new URL(trimmed); } catch { setError('Invalid URL format. Please enter a valid URL.'); return; }

    setLoading(true);
    try {
      const res = await fetch(SWAGGER_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: trimmed }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Server error.'); return; }
      applyResults(data);
      if (data.detectedFeatures) setDetectedFeatures(data.detectedFeatures);
      if (data.parsingSource) setParsingSource(data.parsingSource);
    } catch (err) { setError(`Could not reach the server: ${err.message}. Is the backend running on port 4000?`); }
    finally { setLoading(false); }
  }

  async function generateFromStory() {
    if (!storyInput.trim()) { setError('Please paste a user story.'); return; }
    setLoading(true);
    try {
      const res = await fetch(TEXT_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: storyInput }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Server error.'); return; }
      applyResults(data);
      if (data.detectedFeatures) setDetectedFeatures(data.detectedFeatures);
      if (data.parsingSource) setParsingSource(data.parsingSource);
    } catch (err) { setError(`Could not reach the server: ${err.message}. Is the backend running on port 4000?`); }
    finally { setLoading(false); }
  }

  async function generateFromFile() {
    if (!uploadedFile) { setError('Please select a file to upload (.txt, .pdf, or .docx).'); return; }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      const res = await fetch(FILE_API_URL, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Server error.'); return; }
      applyResults(data);
      if (data.detectedFeatures) setDetectedFeatures(data.detectedFeatures);
      if (data.parsingSource) setParsingSource(data.parsingSource);
      if (data.extractedTextPreview) setExtractedPreview(data.extractedTextPreview);
      if (data.fileName) setFileName(data.fileName);
    } catch (err) { setError(`Could not reach the server: ${err.message}. Is the backend running on port 4000?`); }
    finally { setLoading(false); }
  }

  async function testConnection() {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) {
        setToast('Backend connection successful!');
        return true;
      } else {
        setError('Backend returned error status');
        return false;
      }
    } catch (err) {
      setError(`Backend connection failed: ${err.message}. Ensure backend is running on port 4000.`);
      return false;
    }
  }

  function applyResults(data) {
    setTestCases(data.testCases); setJunitCode(data.junitCode); setSummary(data.summary);
    if (data.aiWarning) setAiWarning(data.aiWarning);
    setToast(`${data.summary.total} test cases generated successfully!`);
  }

  const [downloadOpen, setDownloadOpen] = useState(false);

  function handleDownloadJUnit() {
    const blob = new Blob([junitCode], { type: 'text/x-java-source' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'GeneratedControllerTest.java'; a.click(); URL.revokeObjectURL(url);
    setDownloadOpen(false);
  }

  async function handleDownloadExcel() {
    setDownloadOpen(false);
    try {
      const downloadCases = filtered.map((tc) => ({
        ...tc,
        priority: getDisplayPriority(tc.priority, tc.category),
      }));
      const res = await fetch(DOWNLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCases: downloadCases }),
      });
      if (!res.ok) { setError('Failed to generate Excel file.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'testcases.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch { setError('Could not download Excel. Is the backend running?'); }
  }

  function handleCopy() { navigator.clipboard.writeText(junitCode).then(() => setCopied(true)); }

  function handleLoadSample() {
    if (inputMode === 'json') setJsonInput(SAMPLE_JSON);
    else if (inputMode === 'story') setStoryInput(SAMPLE_STORY);
    setError('');
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'pdf', 'docx'].includes(ext)) {
      setError('Unsupported file type. Please upload a .txt, .pdf, or .docx file.');
      resetFileInput();
      return;
    }
    setError('');
    setUploadedFile(file);
  }

  function toggleRow(id) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() { setExpandedRows(new Set(filtered.map((tc) => tc.id))); }
  function collapseAll() { setExpandedRows(new Set()); }

  const allCategories = summary ? ['all', ...Object.keys(summary.byCategory)] : ['all'];
  const filtered = testCases.filter((tc) => {
    if (categoryFilter !== 'all' && tc.category !== categoryFilter) return false;
    if (priorityFilter !== 'ALL' && getDisplayPriority(tc.priority, tc.category) !== priorityFilter) return false;
    return true;
  });

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <h1>QA Test Generator</h1>
          </div>
          <p className="subtitle">Generate QA-engineer-level test cases from API specs, user stories, or uploaded documents</p>
        </div>
      </header>

      <main className="main">
        {/* Input Section */}
        <section className="card input-section">
          <div className="card-header">
            <h2>Input</h2>
            <div className="card-header-actions">
              <button className="btn btn-ghost" onClick={testConnection}>Test Connection</button>
              {inputMode !== 'file' && inputType !== 'swagger' && (
                <button className="btn btn-ghost" onClick={handleLoadSample}>Load Sample</button>
              )}
            </div>
          </div>

          <div className="input-mode-toggle">
            <button className={`mode-btn ${inputMode === 'json' ? 'active' : ''}`} onClick={() => { setInputMode('json'); resetResults(); resetFileInput(); }}>API Input</button>
            <button className={`mode-btn ${inputMode === 'story' ? 'active' : ''}`} onClick={() => { setInputMode('story'); resetResults(); resetFileInput(); }}>User Story</button>
            <button className={`mode-btn ${inputMode === 'file' ? 'active' : ''}`} onClick={() => { setInputMode('file'); resetResults(); }}>Upload File</button>
          </div>

          {inputMode === 'json' && (
            <>
              <div className="api-sub-toggle">
                <label className={`sub-radio ${inputType === 'json' ? 'active' : ''}`}>
                  <input type="radio" name="inputType" value="json" checked={inputType === 'json'} onChange={() => { setInputType('json'); setError(''); }} />
                  JSON Input
                </label>
                <label className={`sub-radio ${inputType === 'swagger' ? 'active' : ''}`}>
                  <input type="radio" name="inputType" value="swagger" checked={inputType === 'swagger'} onChange={() => { setInputType('swagger'); setError(''); }} />
                  Swagger URL
                </label>
              </div>

              {inputType === 'json' && (
                <textarea className="json-input" placeholder={`{\n  "endpoint": "/users",\n  "method": "POST",\n  "fields": { "email": "string", "age": "number" }\n}`} value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} spellCheck={false} />
              )}

              {inputType === 'swagger' && (
                <div className="swagger-input-group">
                  <input
                    type="url"
                    className="swagger-url-input"
                    placeholder="https://petstore.swagger.io/v2/swagger.json"
                    value={swaggerUrl}
                    onChange={(e) => setSwaggerUrl(e.target.value)}
                  />
                  <p className="swagger-hint">Supports OpenAPI 2.0 (Swagger) and OpenAPI 3.x JSON specs</p>
                </div>
              )}
            </>
          )}

          {inputMode === 'story' && (
            <textarea className="json-input story-input" placeholder="Paste user story or requirements here..." value={storyInput} onChange={(e) => setStoryInput(e.target.value)} spellCheck={true} />
          )}

          {inputMode === 'file' && (
            <div className="file-upload-area">
              <label className="file-drop-zone" htmlFor="file-input">
                <div className="file-drop-content">
                  <span className="file-icon">📄</span>
                  {uploadedFile ? (
                    <div className="file-selected">
                      <span className="file-name">{uploadedFile.name}</span>
                      <span className="file-size">({(uploadedFile.size / 1024).toFixed(1)} KB)</span>
                      <button className="btn btn-ghost btn-sm file-remove" onClick={(e) => { e.preventDefault(); resetFileInput(); }}>Remove</button>
                    </div>
                  ) : (
                    <>
                      <span className="file-label">Click to select or drag a file here</span>
                      <span className="file-hint">Accepted formats: .txt, .pdf, .docx (max 10 MB)</span>
                    </>
                  )}
                </div>
                <input id="file-input" ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleFileChange} className="file-hidden-input" />
              </label>
            </div>
          )}

          {inputMode === 'json' && inputType === 'json' && (
            <div className="ai-toggle-row">
              <label className="toggle-label">
                <div className={`toggle-switch ${enhanceAI ? 'on' : ''}`} onClick={() => setEnhanceAI(!enhanceAI)}>
                  <div className="toggle-knob" />
                </div>
                <span>Enhance with AI</span>
                <span className="toggle-hint">(OpenRouter)</span>
              </label>
            </div>
          )}

          {error && <p className="error-msg">{error}</p>}
          {aiWarning && <p className="warning-msg">AI Warning: {aiWarning}</p>}

          <button className="btn btn-primary generate-btn" onClick={handleGenerate} disabled={loading}>
            {loading ? (<><span className="spinner" />{inputType === 'swagger' ? 'Fetching Swagger & generating…' : 'Generating…'}</>) : 'Generate Test Cases'}
          </button>
        </section>

        {/* Extracted Text Preview (file upload) */}
        {extractedPreview && (
          <section className="card extracted-preview-card">
            <div className="card-header">
              <h2>Extracted Text {fileName && <span className="file-tag">{fileName}</span>}</h2>
            </div>
            <pre className="extracted-text">{extractedPreview}</pre>
          </section>
        )}

        {/* Detected Features */}
        {detectedFeatures.length > 0 && (
          <section className="card detected-features-card">
            <div className="card-header">
              <h2>Detected Features</h2>
              <span className="badge">{parsingSource === 'ai' ? 'AI-parsed' : 'Keyword-parsed'}</span>
            </div>
            <div className="feature-tags">
              {detectedFeatures.map((f, i) => <span key={i} className="feature-tag">{f}</span>)}
            </div>
          </section>
        )}

        {/* Summary Cards */}
        {summary && (
          <section className="summary-row">
            <div className="summary-card total-card">
              <span className="summary-number">{summary.total}</span>
              <span className="summary-label">Total Tests</span>
            </div>
            {Object.entries(summary.byCategory).map(([cat, count]) => (
              <div className={`summary-card clickable ${categoryFilter === cat ? 'active' : ''}`} key={cat}
                onClick={() => setCategoryFilter(cat === categoryFilter ? 'all' : cat)}>
                <span className="summary-number">{count}</span>
                <span className="summary-label">{CATEGORY_LABELS[cat] || cat}</span>
              </div>
            ))}
          </section>
        )}

        {/* Results Section */}
        {testCases.length > 0 && (
          <section className="card results-section">
            <div className="card-header">
              <h2>
                Results
                {categoryFilter !== 'all' && (
                  <span className="filter-tag">
                    {CATEGORY_LABELS[categoryFilter] || categoryFilter}
                    <button className="clear-filter" onClick={() => setCategoryFilter('all')}>×</button>
                  </span>
                )}
                {priorityFilter !== 'ALL' && (
                  <span className="filter-tag filter-tag-priority">
                    {priorityFilter}
                    <button className="clear-filter" onClick={() => setPriorityFilter('ALL')}>×</button>
                  </span>
                )}
              </h2>
              <span className="badge">{filtered.length} test cases</span>
            </div>

            <div className="tabs">
              <button className={`tab ${activeTab === 'table' ? 'active' : ''}`} onClick={() => setActiveTab('table')}>Test Cases</button>
              <button className={`tab ${activeTab === 'code' ? 'active' : ''}`} onClick={() => setActiveTab('code')}>JUnit Code</button>
            </div>

            {activeTab === 'table' && (
              <>
                <div className="category-filters">
                  {allCategories.map((cat) => (
                    <button key={cat} className={`cat-btn cat-${catClass(cat)} ${categoryFilter === cat ? 'active' : ''}`} onClick={() => setCategoryFilter(cat)}>
                      {CATEGORY_LABELS[cat] || cat}
                    </button>
                  ))}
                  <div className="priority-filter-group">
                    <select
                      className="priority-select"
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p === 'ALL' ? 'Priority: All' : p}</option>
                      ))}
                    </select>
                  </div>
                  <span className="expand-controls">
                    <button className="btn btn-ghost btn-sm" onClick={expandAll}>Expand All</button>
                    <button className="btn btn-ghost btn-sm" onClick={collapseAll}>Collapse All</button>
                  </span>
                </div>
                <div className="table-wrapper">
                  <table className="test-table">
                    <thead>
                      <tr className="header-row-1">
                        <th rowSpan={2} style={{ width: '3.5rem' }}>TC ID</th>
                        <th rowSpan={2}>Title</th>
                        <th rowSpan={2} style={{ width: '6rem' }}>Priority</th>
                        <th rowSpan={2} style={{ width: '7rem' }}>Type</th>
                        <th rowSpan={2}>Expected Result</th>
                        <th colSpan={2} className="exec-status-header">Execution Status</th>
                      </tr>
                      <tr className="header-row-2">
                        <th style={{ width: '5rem' }}>DEV</th>
                        <th style={{ width: '5rem' }}>QA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((tc) => (
                        <React.Fragment key={tc.id}>
                          <tr className={`expandable-row ${expandedRows.has(tc.id) ? 'expanded' : ''}`} onClick={() => toggleRow(tc.id)}>
                            <td className="id-cell">{tc.id}</td>
                            <td className="title-cell">
                              <span className="row-toggle">{expandedRows.has(tc.id) ? '▾' : '▸'}</span>
                              {tc.title}
                            </td>
                            <td>
                              {(() => { const dp = getDisplayPriority(tc.priority, tc.category); return (
                                <span
                                  className={`priority-badge priority-${PRIORITY_CSS_MAP[dp] || 'medium'}`}
                                  title={dp}
                                >
                                  {dp}
                                </span>
                              ); })()}
                            </td>
                            <td>
                              <span className={`cat-badge cat-${catClass(tc.category)}`}>
                                {tc.category}
                              </span>
                            </td>
                            <td className="expected-cell">
                              {typeof tc.expected === 'string' ? tc.expected : (tc.expected?.message || '—')}
                            </td>
                            <td className="exec-cell"></td>
                            <td className="exec-cell"></td>
                          </tr>
                          {expandedRows.has(tc.id) && (
                            <tr className="detail-row">
                              <td colSpan={7}>
                                <div className="detail-grid">
                                  <div className="detail-section">
                                    <h4>Preconditions</h4>
                                    <ul>
                                      {(tc.preconditions || []).map((p, i) => <li key={i}>{p}</li>)}
                                    </ul>
                                  </div>
                                  <div className="detail-section">
                                    <h4>Steps</h4>
                                    <ol>
                                      {(tc.steps || []).map((s, i) => <li key={i}>{s}</li>)}
                                    </ol>
                                  </div>
                                  <div className="detail-section detail-expected">
                                    <h4>Expected Result</h4>
                                    <p>{typeof tc.expected === 'string' ? tc.expected : (tc.expected?.error || tc.expected?.message || '—')}</p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'code' && (
              <div className="code-wrapper">
                <button className="btn btn-copy" onClick={handleCopy}>{copied ? '✓ Copied!' : 'Copy to Clipboard'}</button>
                <pre className="code-block"><code>{junitCode}</code></pre>
              </div>
            )}

            <div className="action-row">
              <div className="download-dropdown">
                <button className="btn btn-secondary" onClick={() => setDownloadOpen(!downloadOpen)}>
                  Download {downloadOpen ? '▲' : '▼'}
                </button>
                {downloadOpen && (
                  <div className="download-menu">
                    <button className="download-option" onClick={handleDownloadExcel}>Excel (.xlsx)</button>
                    <button className="download-option" onClick={handleDownloadJUnit}>JUnit (.java)</button>
                  </div>
                )}
              </div>
              <button className="btn btn-ghost" onClick={handleCopy}>{copied ? '✓ Copied!' : '📋 Copy Code'}</button>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>QA Test Case Generator — ThinkTank Hackathon 2026</p>
      </footer>
    </div>
  );
}

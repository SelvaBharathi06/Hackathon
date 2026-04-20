import React, { useState, useEffect } from 'react';
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

const JSON_API_URL = 'http://localhost:4000/generate-tests';
const TEXT_API_URL = 'http://localhost:4000/generate-from-text';

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

export default function App() {
  const [inputMode, setInputMode] = useState('json');
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [storyInput, setStoryInput] = useState('');
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

  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }
  }, [toast]);

  useEffect(() => {
    if (copied) { const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }
  }, [copied]);

  function resetResults() {
    setError(''); setTestCases([]); setJunitCode(''); setSummary(null);
    setCategoryFilter('all'); setToast(null); setAiWarning('');
    setDetectedFeatures([]); setParsingSource(''); setExpandedRows(new Set());
  }

  async function handleGenerate() {
    resetResults();
    if (inputMode === 'json') await generateFromJSON();
    else await generateFromStory();
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
    } catch { setError('Could not reach the server. Is the backend running on port 4000?'); }
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
    } catch { setError('Could not reach the server. Is the backend running on port 4000?'); }
    finally { setLoading(false); }
  }

  function applyResults(data) {
    setTestCases(data.testCases); setJunitCode(data.junitCode); setSummary(data.summary);
    if (data.aiWarning) setAiWarning(data.aiWarning);
    setToast(`${data.summary.total} test cases generated successfully!`);
  }

  function handleDownload() {
    const blob = new Blob([junitCode], { type: 'text/x-java-source' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'GeneratedControllerTest.java'; a.click(); URL.revokeObjectURL(url);
  }

  function handleCopy() { navigator.clipboard.writeText(junitCode).then(() => setCopied(true)); }

  function handleLoadSample() {
    if (inputMode === 'json') setJsonInput(SAMPLE_JSON);
    else setStoryInput(SAMPLE_STORY);
    setError('');
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
  const filtered = categoryFilter === 'all' ? testCases : testCases.filter((tc) => tc.category === categoryFilter);

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <h1>QA Test Generator</h1>
          </div>
          <p className="subtitle">Generate QA-engineer-level test cases from API specs or user stories</p>
        </div>
      </header>

      <main className="main">
        {/* Input Section */}
        <section className="card input-section">
          <div className="card-header">
            <h2>Input</h2>
            <button className="btn btn-ghost" onClick={handleLoadSample}>Load Sample</button>
          </div>

          <div className="input-mode-toggle">
            <button className={`mode-btn ${inputMode === 'json' ? 'active' : ''}`} onClick={() => { setInputMode('json'); resetResults(); }}>JSON Input</button>
            <button className={`mode-btn ${inputMode === 'story' ? 'active' : ''}`} onClick={() => { setInputMode('story'); resetResults(); }}>User Story Input</button>
          </div>

          {inputMode === 'json' ? (
            <textarea className="json-input" placeholder={`{\n  "endpoint": "/users",\n  "method": "POST",\n  "fields": { "email": "string", "age": "number" }\n}`} value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} spellCheck={false} />
          ) : (
            <textarea className="json-input story-input" placeholder="Paste user story or requirements here..." value={storyInput} onChange={(e) => setStoryInput(e.target.value)} spellCheck={true} />
          )}

          {inputMode === 'json' && (
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
            {loading ? (<><span className="spinner" />Generating…</>) : 'Generate Test Cases'}
          </button>
        </section>

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
                  <span className="expand-controls">
                    <button className="btn btn-ghost btn-sm" onClick={expandAll}>Expand All</button>
                    <button className="btn btn-ghost btn-sm" onClick={collapseAll}>Collapse All</button>
                  </span>
                </div>
                <div className="table-wrapper">
                  <table className="test-table">
                    <thead>
                      <tr>
                        <th style={{ width: '3rem' }}>ID</th>
                        <th>Title</th>
                        <th style={{ width: '7rem' }}>Category</th>
                        <th style={{ width: '5rem' }}>Priority</th>
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
                              <span className={`cat-badge cat-${catClass(tc.category)}`}>
                                {tc.category}
                              </span>
                            </td>
                            <td>
                              <span className={`priority-badge priority-${tc.priority}`}>
                                {tc.priority}
                              </span>
                            </td>
                          </tr>
                          {expandedRows.has(tc.id) && (
                            <tr className="detail-row">
                              <td colSpan={4}>
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
              <button className="btn btn-secondary" onClick={handleDownload}>⬇ Download JUnit File</button>
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

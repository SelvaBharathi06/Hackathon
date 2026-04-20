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

const API_URL = 'http://localhost:4000/generate-tests';

const CATEGORIES = ['all', 'happy', 'negative', 'boundary', 'edge', 'security', 'ai-generated'];
const CATEGORY_LABELS = {
  all: 'All',
  happy: 'Happy Path',
  negative: 'Negative',
  boundary: 'Boundary',
  edge: 'Edge Cases',
  security: 'Security',
  'ai-generated': 'AI Generated',
};

const PRIORITY_COLORS = { high: '#e53e3e', medium: '#dd6b20', low: '#38a169' };

export default function App() {
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [testCases, setTestCases] = useState([]);
  const [junitCode, setJunitCode] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('table');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [enhanceAI, setEnhanceAI] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [aiWarning, setAiWarning] = useState('');

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(t);
    }
  }, [copied]);

  async function handleGenerate() {
    setError('');
    setTestCases([]);
    setJunitCode('');
    setSummary(null);
    setCategoryFilter('all');
    setToast(null);
    setAiWarning('');

    if (!jsonInput.trim()) {
      setError('Please paste API JSON input.');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonInput);
    } catch {
      setError('Invalid JSON. Please check your input and try again.');
      return;
    }

    if (enhanceAI) {
      parsed.enhanceWithAI = true;
    }

    setLoading(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Server error.');
        return;
      }
      setTestCases(data.testCases);
      setJunitCode(data.junitCode);
      setSummary(data.summary);
      if (data.aiWarning) setAiWarning(data.aiWarning);
      setToast(`${data.summary.total}+ test cases generated successfully!`);
    } catch {
      setError('Could not reach the server. Is the backend running on port 4000?');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    const blob = new Blob([junitCode], { type: 'text/x-java-source' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'GeneratedControllerTest.java';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    navigator.clipboard.writeText(junitCode).then(() => setCopied(true));
  }

  function handleLoadSample() {
    setJsonInput(SAMPLE_JSON);
    setError('');
  }

  const visibleCategories = CATEGORIES.filter(
    (c) => c === 'all' || (summary && summary.byCategory[c])
  );

  const filtered =
    categoryFilter === 'all'
      ? testCases
      : testCases.filter((tc) => tc.category === categoryFilter);

  return (
    <div className="app">
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <h1>API Test Generator</h1>
          </div>
          <p className="subtitle">
            Paste your API spec JSON and generate JUnit 5 test cases instantly
          </p>
        </div>
      </header>

      <main className="main">
        {/* Input Section */}
        <section className="card input-section">
          <div className="card-header">
            <h2>API Specification</h2>
            <button className="btn btn-ghost" onClick={handleLoadSample}>
              Load Sample
            </button>
          </div>
          <textarea
            className="json-input"
            placeholder={`{\n  "endpoint": "/users",\n  "method": "POST",\n  "fields": {\n    "email": "string",\n    "age": "number"\n  }\n}`}
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            spellCheck={false}
          />

          {/* AI Toggle */}
          <div className="ai-toggle-row">
            <label className="toggle-label">
              <div className={`toggle-switch ${enhanceAI ? 'on' : ''}`} onClick={() => setEnhanceAI(!enhanceAI)}>
                <div className="toggle-knob" />
              </div>
              <span>Enhance with AI</span>
              <span className="toggle-hint">(Google Gemini)</span>
            </label>
          </div>

          {error && <p className="error-msg">{error}</p>}
          {aiWarning && <p className="warning-msg">AI Warning: {aiWarning}</p>}

          <button
            className="btn btn-primary generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner" />
                Generating…
              </>
            ) : (
              'Generate Test Cases'
            )}
          </button>
        </section>

        {/* Summary Cards */}
        {summary && (
          <section className="summary-row">
            <div className="summary-card total-card">
              <span className="summary-number">{summary.total}</span>
              <span className="summary-label">Total Tests</span>
            </div>
            {Object.entries(summary.byCategory).map(([cat, count]) => (
              <div
                className={`summary-card clickable ${categoryFilter === cat ? 'active' : ''}`}
                key={cat}
                onClick={() => setCategoryFilter(cat === categoryFilter ? 'all' : cat)}
              >
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
                    <button className="clear-filter" onClick={() => setCategoryFilter('all')}>
                      ×
                    </button>
                  </span>
                )}
              </h2>
              <span className="badge">{filtered.length} test cases</span>
            </div>

            <div className="tabs">
              <button
                className={`tab ${activeTab === 'table' ? 'active' : ''}`}
                onClick={() => setActiveTab('table')}
              >
                Test Cases
              </button>
              <button
                className={`tab ${activeTab === 'code' ? 'active' : ''}`}
                onClick={() => setActiveTab('code')}
              >
                JUnit Code
              </button>
            </div>

            {activeTab === 'table' && (
              <>
                <div className="category-filters">
                  {visibleCategories.map((cat) => (
                    <button
                      key={cat}
                      className={`cat-btn cat-${cat} ${categoryFilter === cat ? 'active' : ''}`}
                      onClick={() => setCategoryFilter(cat)}
                    >
                      {CATEGORY_LABELS[cat] || cat}
                    </button>
                  ))}
                </div>
                <div className="table-wrapper">
                  <table className="test-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Scenario</th>
                        <th>Category</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Expected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((tc) => (
                        <tr key={tc.id}>
                          <td className="id-cell">{tc.id}</td>
                          <td>{tc.scenario}</td>
                          <td>
                            <span className={`cat-badge cat-${tc.category}`}>
                              {CATEGORY_LABELS[tc.category] || tc.category}
                            </span>
                          </td>
                          <td>
                            <span className={`priority-badge priority-${tc.priority}`}>
                              {tc.priority.toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`status-badge status-${Math.floor(tc.expected.status / 100)}xx`}
                            >
                              {tc.expected.status}
                            </span>
                          </td>
                          <td className="mono">
                            {tc.expected.error || tc.expected.message || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'code' && (
              <div className="code-wrapper">
                <button className="btn btn-copy" onClick={handleCopy}>
                  {copied ? '✓ Copied!' : 'Copy to Clipboard'}
                </button>
                <pre className="code-block">
                  <code>{junitCode}</code>
                </pre>
              </div>
            )}

            <div className="action-row">
              <button className="btn btn-secondary" onClick={handleDownload}>
                ⬇ Download JUnit File
              </button>
              <button className="btn btn-ghost" onClick={handleCopy}>
                {copied ? '✓ Copied!' : '📋 Copy Code'}
              </button>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>API Test Case Generator — ThinkTank Hackathon 2026</p>
      </footer>
    </div>
  );
}

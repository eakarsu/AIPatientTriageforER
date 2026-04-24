import React from 'react';

function formatAIContent(text) {
  if (!text) return '';
  // Convert markdown-like formatting to HTML
  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    .replace(/^- (.*$)/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*(?:<br\/>)?)+)/g, '<ul>$1</ul>');

  return `<p>${html}</p>`;
}

export default function AIResultDisplay({ result, loading, model }) {
  if (loading) {
    return (
      <div className="ai-result">
        <div className="ai-loading">
          <div className="spinner"></div>
          <span>AI is analyzing... Please wait</span>
        </div>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="ai-result">
      <div className="ai-result-header">
        <span className="ai-icon">🤖</span>
        <h3>AI Analysis Result</h3>
        {model && <span className="ai-model">{model}</span>}
      </div>
      <div
        className="ai-result-body"
        dangerouslySetInnerHTML={{ __html: formatAIContent(result) }}
      />
    </div>
  );
}

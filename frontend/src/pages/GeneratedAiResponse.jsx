import React, { useMemo, useState } from 'react';

const LABELS = {
  result: 'Analysis',
  summary: 'Executive summary',
  prioritized_actions: 'Prioritized actions',
  actions: 'Recommended actions',
  risks: 'Risks and safeguards',
  missing_information: 'Missing information',
  assumptions: 'Assumptions',
  follow_up_questions: 'Follow-up questions',
  recommendations: 'Recommendations',
};

function displayLabel(value) {
  return LABELS[value] || value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseValue(value) {
  if (typeof value !== 'string') return value;
  const cleaned = value.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) return value;
  try { return JSON.parse(cleaned); } catch { return value; }
}

function Narrative({ text }) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return <p style={{ margin: 0, lineHeight: 1.72, color: '#334155' }}>{text}</p>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {lines.map((line, index) => {
        const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
        const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^([^:]{2,48}):$/);
        if (heading) return <h4 key={index} style={{ margin: '8px 0 0', color: '#0f172a', fontSize: 15 }}>{heading[1]}</h4>;
        if (bullet) return <div key={index} style={{ display: 'flex', gap: 10, lineHeight: 1.65, color: '#334155' }}><span style={{ color: '#2563eb', fontWeight: 800 }}>•</span><span>{bullet[1]}</span></div>;
        return <p key={index} style={{ margin: 0, lineHeight: 1.72, color: '#334155' }}>{line}</p>;
      })}
    </div>
  );
}

function StructuredValue({ value, depth = 0 }) {
  const parsed = parseValue(value);
  if (parsed == null) return <span style={{ color: '#64748b' }}>Not provided</span>;
  if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') return <Narrative text={String(parsed)} />;
  if (Array.isArray(parsed)) {
    return (
      <div style={{ display: 'grid', gap: 9 }}>
        {parsed.map((item, index) => (
          <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ minWidth: 24, height: 24, borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{index + 1}</span>
            <div style={{ flex: 1, paddingTop: 1 }}><StructuredValue value={item} depth={depth + 1} /></div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: depth ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {Object.entries(parsed).map(([key, item]) => (
        <section key={key} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
          <h4 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: 14 }}>{displayLabel(key)}</h4>
          <StructuredValue value={item} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}

export default function GeneratedAiResponse({ response }) {
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseValue(response), [response]);
  if (!parsed) return null;

  const payload = typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { result: parsed };
  const providerContent = payload.choices?.[0]?.message?.content;
  const content = parseValue(payload.result ?? payload.ai_result ?? payload.content ?? payload.analysis ?? payload.structured ?? payload.output ?? payload.response ?? payload.data ?? providerContent ?? payload);
  const isError = Boolean(payload.error) && !payload.result && !payload.ai_result && !payload.content && !payload.analysis && !payload.structured && !payload.output && !payload.response && !providerContent;
  const title = payload.title || (payload.feature ? displayLabel(payload.feature) : (isError ? 'AI request could not be completed' : 'AI-generated analysis'));
  const model = payload.model ?? payload.model_used ?? payload.providerReceipt?.model;
  const tokenCount = payload.usage?.total_tokens ?? payload.providerReceipt?.usage?.total_tokens ?? payload.tokens;
  const copyText = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const copy = async () => {
    await navigator.clipboard?.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <article role={isError ? 'alert' : 'region'} style={{ marginTop: 24, border: `1px solid ${isError ? '#fecaca' : '#cbd5e1'}`, borderRadius: 16, overflow: 'hidden', background: isError ? '#fff7f7' : '#f8fafc', boxShadow: '0 14px 36px rgba(15, 23, 42, 0.08)' }}>
      <header style={{ padding: '18px 20px', background: isError ? 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 11, fontWeight: 800, color: isError ? '#fecaca' : '#93c5fd', marginBottom: 6 }}>{isError ? 'AI request failed' : 'AI analysis complete'}</div>
          <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>{title}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {model && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>Model: {model}</span>}
            {tokenCount && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>{tokenCount} tokens</span>}
            {payload.cached && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>Cached result</span>}
          </div>
        </div>
        {!isError && <button type="button" onClick={copy} style={{ border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.1)', color: '#fff', borderRadius: 9, padding: '8px 12px', cursor: 'pointer', fontWeight: 700 }}>{copied ? 'Copied' : 'Copy report'}</button>}
      </header>

      <div style={{ padding: 20 }}>
        <StructuredValue value={content} />
        {payload.disclaimer && <div style={{ marginTop: 16, borderLeft: '4px solid #f59e0b', background: '#fffbeb', padding: '10px 12px', color: '#78350f', fontSize: 12, lineHeight: 1.55 }}>{payload.disclaimer}</div>}
        <details style={{ marginTop: 14, color: '#475569', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Technical response details</summary>
          <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', background: '#0f172a', color: '#dbeafe', borderRadius: 10, padding: 12 }}>{JSON.stringify(payload, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
}

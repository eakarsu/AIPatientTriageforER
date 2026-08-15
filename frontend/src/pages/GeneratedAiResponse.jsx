import React, { useMemo, useState } from 'react';

const LABELS = {
  result: 'Analysis',
  summary: 'Executive summary',
  analysis_summary: 'Executive summary',
  key_findings: 'Key findings',
  prioritized_actions: 'Prioritized actions',
  actions: 'Recommended actions',
  next_steps: 'Next steps',
  risks: 'Risks and safeguards',
  safeguards: 'Safeguards',
  missing_information: 'Missing information',
  assumptions: 'Assumptions',
  follow_up_questions: 'Follow-up questions',
  recommendations: 'Recommendations',
  confidence: 'AI confidence',
};

const SECTION_PRIORITY = [
  'summary', 'analysis_summary', 'overview', 'confidence', 'key_findings', 'findings',
  'recommendations', 'prioritized_actions', 'actions', 'next_steps', 'risks', 'safeguards',
  'missing_information', 'assumptions', 'follow_up_questions',
];

function displayLabel(value) {
  return LABELS[value] || String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function tryJson(value) {
  try { return JSON.parse(value); } catch { return undefined; }
}

function repairTruncatedJson(value) {
  if (!value.startsWith('{') && !value.startsWith('[')) return undefined;
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') stack.push('}');
    else if (character === '[') stack.push(']');
    else if ((character === '}' || character === ']') && stack.at(-1) === character) stack.pop();
  }

  let repaired = value.trimEnd();
  if (inString) {
    if (escaped && repaired.endsWith('\\')) repaired = repaired.slice(0, -1);
    repaired += '"';
  }
  repaired = repaired.replace(/,\s*$/, '');
  if (/:\s*$/.test(repaired)) repaired += 'null';
  repaired += stack.reverse().join('');
  return tryJson(repaired);
}

function readJsonishValue(source, start) {
  let index = start;
  while (/\s/.test(source[index] || '')) index += 1;
  const opening = source[index];
  if (!opening) return undefined;

  if (opening === '"') {
    let escaped = false;
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') return tryJson(source.slice(index, cursor + 1));
    }
    return source.slice(index + 1).replace(/\\[nrt]/g, ' ').replace(/\\"/g, '"').trim();
  }

  if (opening === '{' || opening === '[') {
    const closing = opening === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let cursor = index; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === opening) depth += 1;
      else if (character === closing) {
        depth -= 1;
        if (depth === 0) return tryJson(source.slice(index, cursor + 1));
      }
    }
    return repairTruncatedJson(source.slice(index));
  }

  const primitive = source.slice(index).split(/[,\r\n}]/, 1)[0].trim();
  return tryJson(primitive) ?? primitive;
}

function parseLooseJsonObject(value) {
  const keys = [
    'summary', 'analysis_summary', 'overview', 'confidence', 'ai_confidence', 'key_findings',
    'findings', 'recommendations', 'prioritized_actions', 'actions', 'next_steps', 'risks',
    'safeguards', 'assumptions', 'missing_information', 'follow_up_questions',
  ];
  const recovered = {};
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:`).exec(value);
    if (!match) continue;
    const parsed = readJsonishValue(value, match.index + match[0].length);
    if (parsed !== undefined && parsed !== '') recovered[key] = parsed;
  }
  return Object.keys(recovered).length ? recovered : undefined;
}

export function parseAiValue(value) {
  if (typeof value !== 'string') return value;
  const original = value.replace(/^\uFEFF/, '').trim();
  if (!original) return '';

  const fenced = original.match(/^```(?:json|javascript|js)?[ \t]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?```$/i);
  let candidate = (fenced?.[1] ?? original
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')).trim();

  for (let pass = 0; pass < 2; pass += 1) {
    const parsed = tryJson(candidate);
    if (parsed === undefined) break;
    if (typeof parsed !== 'string') return parsed;
    candidate = parsed.trim();
  }

  if (!fenced && !candidate.startsWith('{') && !candidate.startsWith('[')) {
    const embedded = candidate.match(/```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?```/i);
    if (embedded) {
      const parsed = tryJson(embedded[1].trim());
      if (parsed !== undefined) return parsed;
      return embedded[1].trim();
    }
  }

  const opening = candidate[0];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : '';
  if (closing) {
    const last = candidate.lastIndexOf(closing);
    const parsed = tryJson(last >= 0 ? candidate.slice(0, last + 1) : candidate);
    if (parsed !== undefined) return parsed;
    const repaired = repairTruncatedJson(candidate);
    if (repaired !== undefined) return repaired;
    const recovered = parseLooseJsonObject(candidate);
    if (recovered !== undefined) return recovered;
  }

  return candidate
    .replace(/^```[^\r\n]*\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .trim();
}

function stripMarkdown(value) {
  return String(value)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function Narrative({ text }) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) return <p style={{ margin: 0, lineHeight: 1.72, color: '#334155' }}>{stripMarkdown(text)}</p>;
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {lines.map((line, index) => {
        const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
        const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^([^:]{2,48}):$/);
        if (heading) return <h4 key={index} style={{ margin: '8px 0 0', color: '#0f172a', fontSize: 15 }}>{stripMarkdown(heading[1])}</h4>;
        if (bullet) return <div key={index} style={{ display: 'flex', gap: 10, lineHeight: 1.65, color: '#334155' }}><span aria-hidden="true" style={{ color: '#2563eb', fontWeight: 900 }}>•</span><span>{stripMarkdown(bullet[1])}</span></div>;
        return <p key={index} style={{ margin: 0, lineHeight: 1.72, color: '#334155' }}>{stripMarkdown(line)}</p>;
      })}
    </div>
  );
}

function Confidence({ value }) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return <Narrative text={String(value)} />;
  const percent = Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric));
  const label = percent >= 80 ? 'High' : percent >= 55 ? 'Moderate' : 'Needs review';
  const color = percent >= 80 ? '#059669' : percent >= 55 ? '#d97706' : '#dc2626';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 8 }}>
        <strong style={{ color: '#0f172a', fontSize: 22 }}>{Math.round(percent)}%</strong>
        <span style={{ color, fontWeight: 800, fontSize: 12 }}>{label}</span>
      </div>
      <div role="progressbar" aria-label="AI confidence" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)} style={{ height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', borderRadius: 999, background: color }} />
      </div>
    </div>
  );
}

function Primitive({ value }) {
  if (value == null || value === '') return <span style={{ color: '#64748b' }}>Not provided</span>;
  if (typeof value === 'boolean') return <span style={{ color: value ? '#047857' : '#b45309', fontWeight: 700 }}>{value ? 'Yes' : 'No'}</span>;
  return <Narrative text={String(value)} />;
}

function ItemCard({ item, index, depth }) {
  const parsed = parseAiValue(item);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return (
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '11px 0', borderBottom: '1px solid #eef2f7' }}>
        <span style={{ flex: '0 0 26px', height: 26, borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}><StructuredValue value={parsed} depth={depth + 1} /></div>
      </div>
    );
  }

  const headlineKey = ['finding', 'title', 'action', 'recommendation', 'risk', 'name', 'description'].find((key) => parsed[key]);
  const severity = parsed.severity || parsed.priority || parsed.risk_level;
  const details = Object.entries(parsed).filter(([key]) => key !== headlineKey && !['severity', 'priority', 'risk_level'].includes(key));
  return (
    <article style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ flex: '0 0 26px', height: 26, borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{index + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {headlineKey ? <div style={{ color: '#0f172a', fontWeight: 800, lineHeight: 1.5 }}>{stripMarkdown(parsed[headlineKey])}</div> : null}
          {severity ? <span style={{ display: 'inline-block', marginTop: 7, padding: '3px 8px', borderRadius: 999, background: '#fff7ed', color: '#c2410c', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{severity}</span> : null}
        </div>
      </div>
      {details.length ? <div style={{ display: 'grid', gap: 9, marginTop: 12, paddingLeft: 36 }}>{details.map(([key, value]) => <div key={key}><div style={{ color: '#64748b', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>{displayLabel(key)}</div><StructuredValue value={value} depth={depth + 1} /></div>)}</div> : null}
    </article>
  );
}

function StructuredValue({ value, depth = 0, fieldKey = '' }) {
  const parsed = parseAiValue(value);
  if (fieldKey === 'confidence' || fieldKey === 'ai_confidence') return <Confidence value={parsed} />;
  if (parsed == null || ['string', 'number', 'boolean'].includes(typeof parsed)) return <Primitive value={parsed} />;
  if (Array.isArray(parsed)) {
    if (!parsed.length) return <span style={{ color: '#64748b' }}>No items reported</span>;
    return <div style={{ display: 'grid', gap: 10 }}>{parsed.map((item, index) => <ItemCard key={index} item={item} index={index} depth={depth} />)}</div>;
  }

  const entries = Object.entries(parsed).sort(([a], [b]) => {
    const ai = SECTION_PRIORITY.indexOf(a);
    const bi = SECTION_PRIORITY.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: depth ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12 }}>
      {entries.map(([key, item]) => {
        const isSummary = ['summary', 'analysis_summary', 'overview'].includes(key);
        const isRisk = /risk|warning|missing|gap/.test(key);
        return (
          <section key={key} style={{ gridColumn: isSummary ? '1 / -1' : undefined, border: `1px solid ${isRisk ? '#fed7aa' : '#e2e8f0'}`, borderRadius: 12, padding: 15, background: isSummary ? '#eff6ff' : isRisk ? '#fffaf5' : '#fff' }}>
            <h4 style={{ margin: '0 0 9px', color: isRisk ? '#9a3412' : '#0f172a', fontSize: 13, textTransform: 'uppercase', letterSpacing: '.045em' }}>{displayLabel(key)}</h4>
            <StructuredValue value={item} depth={depth + 1} fieldKey={key} />
          </section>
        );
      })}
    </div>
  );
}

function unwrapContent(payload) {
  const providerContent = payload?.choices?.[0]?.message?.content;
  const selected = payload?.result ?? payload?.ai_result ?? payload?.content ?? payload?.analysis ?? payload?.structured ?? payload?.output ?? payload?.response ?? payload?.data ?? providerContent ?? payload;
  return parseAiValue(selected);
}

function toPlainText(value, depth = 0) {
  const parsed = parseAiValue(value);
  if (parsed == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof parsed)) return String(parsed);
  if (Array.isArray(parsed)) return parsed.map((item, index) => `${index + 1}. ${toPlainText(item, depth + 1)}`).join('\n');
  return Object.entries(parsed).map(([key, item]) => `${'#'.repeat(Math.min(depth + 2, 5))} ${displayLabel(key)}\n${toPlainText(item, depth + 1)}`).join('\n\n');
}

export default function GeneratedAiResponse({ response }) {
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseAiValue(response), [response]);
  if (!parsed) return null;

  const payload = typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { result: parsed };
  const content = unwrapContent(payload);
  const hasExplicitContent = ['result', 'ai_result', 'content', 'analysis', 'structured', 'output', 'response', 'data']
    .some((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '');
  const isError = Boolean(payload.error) && !hasExplicitContent && !payload.choices?.[0]?.message?.content;
  const title = payload.title || (payload.feature ? displayLabel(payload.feature) : (isError ? 'AI request could not be completed' : 'AI-generated analysis'));
  const model = payload.model ?? payload.model_used ?? payload.providerReceipt?.model;
  const tokenCount = payload.usage?.total_tokens ?? payload.providerReceipt?.usage?.total_tokens ?? payload.tokens;
  const copyText = `${title}\n\n${toPlainText(content)}`;
  const copy = async () => {
    await navigator.clipboard?.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <article role={isError ? 'alert' : 'region'} aria-label={title} style={{ marginTop: 24, border: `1px solid ${isError ? '#fecaca' : '#cbd5e1'}`, borderRadius: 16, overflow: 'hidden', background: isError ? '#fff7f7' : '#f8fafc', boxShadow: '0 14px 36px rgba(15, 23, 42, 0.08)' }}>
      <header style={{ padding: '18px 20px', background: isError ? 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 11, fontWeight: 900, color: isError ? '#fecaca' : '#93c5fd', marginBottom: 6 }}>{isError ? 'AI request failed' : 'AI analysis complete'}</div>
          <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{title}</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {model && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>Model: {model}</span>}
            {tokenCount && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>{tokenCount} tokens</span>}
            {payload.cached && <span style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(255,255,255,.12)', fontSize: 12 }}>Cached result</span>}
          </div>
        </div>
        {!isError && <button type="button" onClick={copy} style={{ border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.1)', color: '#fff', borderRadius: 9, padding: '8px 12px', cursor: 'pointer', fontWeight: 800 }}>{copied ? 'Copied' : 'Copy report'}</button>}
      </header>

      <div style={{ padding: 'clamp(14px, 4vw, 20px)' }}>
        <StructuredValue value={isError ? (payload.error || payload.message) : content} />
        {payload.disclaimer && <div style={{ marginTop: 16, borderLeft: '4px solid #f59e0b', background: '#fffbeb', padding: '10px 12px', color: '#78350f', fontSize: 12, lineHeight: 1.55 }}>{payload.disclaimer}</div>}
        <details style={{ marginTop: 16, color: '#475569', fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Model and request metadata</summary>
          <div style={{ marginTop: 10, display: 'grid', gap: 6, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fff' }}>
            {model ? <div><strong>Model:</strong> {model}</div> : null}
            {tokenCount ? <div><strong>Tokens:</strong> {tokenCount}</div> : null}
            {payload.createdAt || payload.created_at ? <div><strong>Generated:</strong> {payload.createdAt || payload.created_at}</div> : null}
            {!model && !tokenCount && !payload.createdAt && !payload.created_at ? <div>No additional metadata supplied.</div> : null}
          </div>
        </details>
      </div>
    </article>
  );
}

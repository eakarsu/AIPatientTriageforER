import React from 'react';
import './SharedRecordUI.css';

const optionValue = (option) => typeof option === 'object' ? option.value ?? option.id ?? option.label : option;
const present = (value) => value !== undefined && value !== null && (typeof value === 'object' || String(value).trim() !== '');
const readable = (value) => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
export const requiresSource = (field) => field.requiresExistingRecord || field.recordReference || (!field.allowIllustrativeIdentifier && /(?:^id$|_id$|Id$)/.test(field.key || field.name || ''));

/** Fill declared fields only. Existing scenario data and valid choices take priority. */
export function completeExample(fields, sample = {}, variant = 0, context = 'this feature', current = {}) {
  const provided = sample.values || sample.data || sample;
  const result = {};
  const date = new Date(); date.setDate(date.getDate() + 7 + variant * 7);
  for (const field of fields || []) {
    const key = field.key || field.name;
    if (!key) continue;
    const type = field.type || field.kind || 'text';
    const options = (field.options || []).map(optionValue).filter(present);
    let value = provided[key];
    if (!present(value)) value = field.defaultValue ?? field.default ?? field.example;
    if (type === 'file') { result[key] = current[key] ?? null; continue; }
    if (requiresSource(field)) {
      if (!options.length) { result[key] = present(current[key]) ? current[key] : ''; continue; }
      const selected = options.find(option => String(option) === String(current[key]));
      result[key] = selected ?? options[variant % options.length];
      continue;
    }
    if (type === 'select' && options.length) {
      value = options.some((option) => String(option) === String(value)) ? value : options[variant % options.length];
    } else if (type === 'number' || type === 'range') {
      const parsed = Number(value);
      const fallback = /percent|rate|ratio|confidence/i.test(key) ? [25, 50, 75][variant % 3] : [1, 10, 25][variant % 3];
      value = present(value) && Number.isFinite(parsed) ? parsed : fallback;
      if (field.min !== undefined) value = Math.max(Number(field.min), value);
      if (field.max !== undefined) value = Math.min(Number(field.max), value);
    } else if (type === 'date') {
      value = /^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
    } else if (type === 'datetime-local') {
      value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || '')) ? String(value).slice(0, 16) : `${date.toISOString().slice(0, 10)}T09:00`;
    } else if (type === 'month') value = date.toISOString().slice(0, 7);
    else if (type === 'time') value = present(value) ? value : ['09:00', '13:30', '16:00'][variant % 3];
    else if (type === 'checkbox' || type === 'boolean') value = typeof value === 'boolean' ? value : variant !== 1;
    else if (type === 'json') {
      if (!present(value) && field.placeholder) { try { value = JSON.parse(String(field.placeholder).replace(/,\s*\.\.\.\s*/g, '').replace(/\.\.\.\s*,?/g, '')); } catch (_) { /* Use an explicit illustrative object below. */ } }
      // A domain form supplies typed examples/schema placeholders when an item
      // has required properties. Do not invent arbitrary object properties.
      if (!present(value)) value = field.jsonShape === 'array' || field.schema?.type === 'array' || /array|list/i.test(field.label || '') || /issues|guests|records|items|people|claims|changes|shifts|shift_requirements|slides|messages/.test(key) ? [] : {};
      value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } else if (!present(value)) {
      const label = readable(field.label || key);
      if (type === 'color' || /hex|primary_color|brand_color/i.test(`${key} ${field.label || ''}`)) value = ['#2563eb', '#166534', '#7c3aed'][variant % 3];
      else if (type === 'email' || /email/i.test(key)) value = `example${variant + 1}@example.com`;
      else if (type === 'url' || /website|url/i.test(key)) value = `https://example.com/scenario-${variant + 1}`;
      else if (type === 'tel' || /phone/i.test(key)) value = '+1 202 555 0100';
      else if (/budget|cost|amount|revenue|price/i.test(key)) value = ['2500', '10000', '25000'][variant % 3];
      else if (/language/i.test(key)) value = ['English', 'Spanish', 'French'][variant % 3];
      else if (/format/i.test(key)) value = 'Summary, findings, and prioritized actions';
      else if (/tone/i.test(key)) value = ['Professional', 'Clear and concise', 'Executive'][variant % 3];
      else if (/html/i.test(key)) value = `<main><h1>Example page ${variant + 1}</h1><p>Illustrative page content for an accessibility review.</p><form><label for="example-email">Email address</label><input id="example-email" type="email" /><button type="submit">Send request</button></form><img src="https://example.com/image.png" alt="Illustrative landscape" /></main>`;
      else if (type === 'textarea' || /context|brief|description|notes|constraint|goal|objective|data|text|prompt/i.test(key)) value = `Example ${variant + 1} for ${readable(context)}. ${label}: review the supplied information, identify the main issues, and propose a practical next step. Treat these values as illustrative; identify assumptions and missing evidence.`;
      else value = `${label} — example ${variant + 1}`;
    }
    if (type !== 'json' && value && typeof value === 'object') value = Array.isArray(value) ? value.map((item) => typeof item === 'object' ? Object.values(item).join(' · ') : item).join('\n') : Object.entries(value).map(([name, item]) => `${readable(name)}: ${item}`).join('\n');
    result[key] = value;
  }
  return result;
}

export default function AIFieldPresets({ fields, samples = [], onFill, disabled, context }) {
  if (!fields?.length) return null;
  const examples = samples.length >= 3 ? samples.slice(0, 5) : Array.from({ length: 3 }, (_, index) => samples[index] || { label: ['Quick review', 'Planning scenario', 'Detailed review'][index] });
  return <section className="sr-presets"><div><strong>Fill every field</strong><p>Each example fills required and optional inputs. Review the values and any record references before generating.</p>{fields.some((field) => requiresSource(field) && !field.options?.length) && <p>Select an actual source record to fill reference fields; example buttons never invent record IDs.</p>}{fields.some((field) => (field.type || field.kind) === 'file') && <p>Choose actual files manually. Example buttons preserve selected uploads.</p>}</div><div className="sr-actions">{examples.map((sample, index) => <button key={index} type="button" className="btn secondary btn-secondary" disabled={disabled} onClick={() => onFill(sample, index)}>{sample.label || `Example ${index + 1}`}</button>)}</div></section>;
}

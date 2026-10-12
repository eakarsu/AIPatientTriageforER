"use client";
import React, { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
export function useFullAIExamples() {
    const store = useRef(null);
    if (!store.current)
        store.current = { bindings: new Map(), sequence: 0, bind(binding, slot, identity) { const key = slot + ':' + String(identity ?? ''); this.bindings.set(key, binding); return key; } };
    store.current.bindings = new Map();
    return store.current;
}
const labels = ['Quick review', 'Planning scenario', 'Detailed review'];
const named = (value) => String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
const missing = (value) => value == null || (typeof value === 'string' && !value.trim());
function parse(value) { if (typeof value !== 'string')
    return value; try {
    return JSON.parse(value);
}
catch {
    return undefined;
} }
function primitive(label, type, index, sample) {
    if (type === 'checkbox' || type === 'boolean')
        return index !== 1;
    if (type === 'number' || type === 'range') {
        const value = Number(sample);
        return !missing(sample) && Number.isFinite(value) ? value : [1, 10, 25][index];
    }
    if (type === 'date')
        return `2026-11-${['05', '12', '19'][index]}`;
    if (type === 'datetime-local')
        return `2026-11-${['05', '12', '19'][index]}T${/end|finish|until/i.test(label) ? '17:30' : '09:30'}`;
    if (type === 'time')
        return ['09:00', '13:30', '16:00'][index];
    if (type === 'month')
        return ['2026-11', '2026-12', '2027-01'][index];
    if (type === 'color')
        return ['#2563eb', '#166534', '#7c3aed'][index];
    if (type === 'email')
        return `example${index + 1}@example.com`;
    if (type === 'url')
        return `https://example.com/scenario-${index + 1}`;
    if (type === 'tel')
        return '+12025550100';
    if (!missing(sample) && typeof sample !== 'object')
        return sample;
    return `Fictional ${named(label) || 'scenario'} ${index + 1}. ${['Review the supplied example, identify assumptions and suggest a practical next step.', 'Plan the work, list constraints and evidence needed, and propose owner follow-up.', 'Assess the details, identify missing evidence, and prepare a prioritized review.'][index]} Replace illustrative facts with verified source information before relying on the draft.`;
}
function credentialOrAuthority(label, kind) {
    const tokens = named(label).toLowerCase().replace(/[()[\].:*]+/g, ' ').trim();
    // A consent mechanism/text or approval-context draft describes a hypothetical
    // proposal. It does not grant consent or record an approval.
    if (/(?:^|\s)(?:context|text|description|mechanism|draft|wording|style|notes?|question|summary|instructions?)\s*$/.test(tokens) && kind !== 'checkbox' && kind !== 'boolean')
        return false;
    return /(?:^|\s)(?:password|api key|access token|private key|credential|credentials)(?:\s|$)/.test(tokens)
        || /(?:^|\s)(?:consent|signature|approval|approved|signed|verified|authorization|secret)(?:\s|$)/.test(tokens);
}
function sourceReference(label) {
    const tokens = named(label);
    return /(?:^|[ ._-])(?:ids?|reference)(?:\s*\(?optional\)?)?\s*$/i.test(tokens)
        || /(?:^|[ ._-])(?:source|record|document|file|image|video|evidence)[ ._-]*(?:uri|url|path)(?:\s*\(?optional\)?)?\s*$/i.test(tokens)
        || /^(?:select |selected |saved |actual )?source(?: record)?(?:\s*\(?optional\)?)?\s*$/i.test(tokens);
}
const protectedClinicalLeaf = /(?:diagnos|medication|allerg|clinical|blood.?pressure|heart.?rate|symptoms|medical.?history|medical.?condition|evidence|source.?fact)/i;

function structured(value, current, label, index, manual) {
    if (Array.isArray(value))
        return value.map((item, i) => structured(item, Array.isArray(current) ? current[i] : undefined, `${label} ${i + 1}`, index, manual));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, child]) => {
            const actual = current && typeof current === 'object' ? current[key] : undefined;
            if (sourceReference(key) || credentialOrAuthority(key, typeof child === 'boolean' ? 'boolean' : 'text') || protectedClinicalLeaf.test(key)) {
                manual.add(`${named(key)} (confirm actual source or authority manually)`);
                return [key, actual ?? (typeof child === 'boolean' ? false : Array.isArray(child) ? [] : '')];
            }
            return [key, structured(child, actual, named(key), index, manual)];
        }));
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return value;
    return missing(value) ? primitive(label, 'text', index) : value;
}
function controlLabel(control, binding) {
    const input = control;
    const explicit = input.getAttribute('aria-label');
    if (explicit)
        return named(explicit);
    const nativeLabel = input.labels?.[0] || input.closest('label') || input.parentElement?.querySelector('label');
    const copy = nativeLabel?.cloneNode(true);
    copy?.querySelectorAll('input,select,textarea,button').forEach(item => item.remove());
    const label = copy?.textContent;
    return named(label || input.name || input.id || binding.label || input.placeholder || 'Input');
}
export default function FullAIExamples({ controller, disabled = false }) {
    const container = useRef(null), [notice, setNotice] = useState('');
    function fill(index) {
        const host = container.current?.closest('[data-full-ai-workspace]');
        if (!host || disabled)
            return;
        const filled = new Set(), manual = new Set();
        // Use each native controlled onChange, refreshing its closure after every field.
        // This also preserves native conversions and nested/array update handlers.
        for (;;) {
            const control = Array.from(host.querySelectorAll('[data-full-ai-field]')).find(item => item.closest('[data-full-ai-workspace]') === host && !filled.has(item.dataset.fullAiField || ''));
            if (!control)
                break;
            const key = control.dataset.fullAiField || '', binding = controller.bindings.get(key);
            filled.add(key);
            if (!binding)
                continue;
            const input = (control.matches('input,select,textarea') ? control : control.querySelector('input,select,textarea') || (control.matches('[role=combobox]') ? control.parentElement?.querySelector('select') : null) || control), label = controlLabel(input, binding), kind = input.type || (input.tagName === 'TEXTAREA' ? 'textarea' : 'text');
            const combobox = control.matches('[role=combobox]') ? control : control.querySelector('[role=combobox]');
            if (control.disabled || input.disabled || input.readOnly) {
                manual.add(`${label} (native source or permission control)`);
                continue;
            }
            const gate = binding.manual || credentialOrAuthority(label, kind) || credentialOrAuthority(String(binding.label || '').replace(/^.*\./,''), kind);
            const reference = binding.reference || sourceReference(label) || sourceReference(String(binding.label || '').replace(/^.*\./,'')) || key.split(':').some(sourceReference) || /selected(?:Source|Record|Patient|Encounter|Contract|Claim|Policy|Product|Client|Portfolio|Robot|Zone|Contact|Template|Item|Design|Video|Image|Document|File|Presentation)/i.test(String(binding.label || ''));
            let value;
            if (gate || kind === 'file') {
                manual.add(`${label} (review manually)`);
                continue;
            }
            if (combobox && input.tagName !== 'SELECT') {
                flushSync(() => combobox.dispatchEvent(new input.ownerDocument.defaultView.MouseEvent('mousedown', { bubbles: true, button: 0 })));
                const menuId = combobox.getAttribute('aria-controls');
                const menu = menuId ? input.ownerDocument.getElementById(menuId) : null;
                const options = Array.from((menu || input.ownerDocument).querySelectorAll('[role=option][data-value]')).filter(option => option.dataset.value && option.getAttribute('aria-disabled') !== 'true');
                if (!options.length) {
                    manual.add(`${label} (select a real available option)`);
                    continue;
                }
                const selected = options.find(option => option.dataset.value === String(binding.current ?? ''));
                const option = reference && selected ? selected : options[index % options.length];
                flushSync(() => option.click());
                continue;
            }
            else if (input.tagName === 'SELECT') {
                const options = Array.from(input.options).filter(option => !option.disabled && option.value !== '');
                if (!options.length) {
                    manual.add(`${label} (select a real available source)`);
                    continue;
                }
                const selected = options.find(option => option.value === String(binding.current ?? ''));
                value = reference && selected ? selected.value : options[index % options.length].value;
            }
            else if (reference) {
                if (missing(binding.current))
                    manual.add(`${label} (enter an actual source reference)`);
                continue;
            }
            else if (kind === 'checkbox')
                value = index !== 1;
            else if (kind === 'radio') {
                const group = Array.from(host.querySelectorAll('input[type="radio"]')).filter(item => item.name === input.name && !item.disabled);
                if (group[index % group.length] !== input)
                    continue;
                value = input.value;
            }
            else if (binding.json || /json|structured|array/i.test(`${label} ${input.placeholder || ''}`) || /^[\s]*[\[{]/.test(String(binding.sample ?? binding.current ?? ''))) {
                const sample = parse(binding.sample) ?? parse(input.placeholder) ?? parse(binding.current);
                if (sample == null || typeof sample !== 'object') {
                    manual.add(`${label} (provide data in the native request schema)`);
                    continue;
                }
                value = JSON.stringify(structured(sample, parse(binding.current), label, index, manual), null, 2);
            }
            else {
                value = primitive(label, kind, index, binding.sample);
                if (kind === 'number' || kind === 'range') {
                    if (input.min !== '')
                        value = Math.max(Number(input.min), Number(value));
                    if (input.max !== '')
                        value = Math.min(Number(input.max), Number(value));
                    const step = Number(input.step || '1'), base = Number(input.min || '0');
                    if (input.step !== 'any' && Number.isFinite(step) && step > 0) {
                        let position = Math.round((Number(value) - base) / step);
                        if (input.max !== '')
                            position = Math.min(position, Math.floor((Number(input.max) - base) / step + 1e-9));
                        if (input.min !== '')
                            position = Math.max(position, 0);
                        value = Number((base + position * step).toPrecision(12));
                    }
                }
            }
            if (['date', 'datetime-local', 'time', 'month'].includes(kind)) {
                if (input.min && String(value) < input.min)
                    value = input.min;
                if (input.max && String(value) > input.max)
                    value = input.max;
            }
            if (typeof value === 'string' && input.maxLength > 0)
                value = value.slice(0, input.maxLength);
            const event = { target: { name: input.name, id: input.id, value: String(value ?? ''), checked: typeof value === 'boolean' ? value : kind === 'radio', type: kind }, currentTarget: input, preventDefault() { }, stopPropagation() { } };
            if (kind !== 'checkbox' || Boolean(binding.current) !== value)
                flushSync(() => binding.change(event, typeof value === 'boolean' ? value : undefined));
        }
        setNotice(`Example ${index + 1} filled the editable scenario fields. Generation remains a separate action.${manual.size ? ' Review remaining native requirements: ' + Array.from(manual).join('; ') + '.' : ''} Values are fictional draft inputs, not uploaded evidence or a recorded approval.`);
    }
    if (!controller.bindings.size)
        return null;
    return <React.Fragment><section ref={node => { container.current = node; }} aria-label="Complete AI examples" style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, margin: '16px 0', background: '#f8fafc', color: '#0f172a' }}>
    <strong>Demo AI · Fill all editable fields</strong><p style={{ margin: '6px 0 12px', fontSize: 13 }}>Each choice fills the current form, including optional and nested inputs. Real record references, files, permissions and consent remain subject to the native requirements.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{labels.map((label, index) => <button key={label} type="button" disabled={disabled} onClick={() => fill(index)} style={{ background: '#fff', color: '#1e3a8a', border: '1px solid #93c5fd', borderRadius: 8, padding: '8px 12px', fontWeight: 600 }}>Fill all fields · {label}</button>)}</div>
    {notice && <p role="status" style={{ margin: '12px 0 0', fontSize: 13 }}>{notice}</p>}
  </section></React.Fragment>;
}

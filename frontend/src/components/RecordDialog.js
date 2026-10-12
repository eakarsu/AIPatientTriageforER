import React, { useEffect, useRef } from 'react';
import './SharedRecordUI.css';

export default function RecordDialog({ title = 'Record details', onClose, children }) {
  const dialog = useRef(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector('button, input, select, textarea, [tabindex="0"]')?.focus();
    const keyboard = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current?.(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || [])].filter((item) => !item.hidden);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keyboard); previous?.focus?.(); };
  }, []);
  return <div className="sr-dialog-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}><section ref={dialog} className="sr-dialog" role="dialog" aria-modal="true" aria-label={title}><header className="sr-dialog-header"><h2>{title}</h2><button type="button" className="btn secondary btn-secondary" aria-label="Cancel" onClick={onClose}>×</button></header><div className="sr-dialog-body">{children}</div><footer className="sr-dialog-footer"><button type="button" className="btn secondary btn-secondary" onClick={onClose}>Cancel</button></footer></section></div>;
}

import React from 'react';
import EsiDistributionChart from '../components/EsiDistributionChart';
import WaitTimeHeatmap from '../components/WaitTimeHeatmap';
import TriageRecordPdfExport from '../components/TriageRecordPdfExport';
import TriageProtocolRulesEditor from '../components/TriageProtocolRulesEditor';

export default function CustomViewsPage() {
  return (
    <div data-testid="custom-views-page" style={{ padding: 24, color: '#e5e7eb' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>ER Views</h1>
        <p style={{ color: '#9ca3af', marginTop: 6 }}>
          Custom triage analytics, exports, and protocol configuration.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <EsiDistributionChart />
        <WaitTimeHeatmap />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        <TriageRecordPdfExport />
        <TriageProtocolRulesEditor />
      </section>
    </div>
  );
}

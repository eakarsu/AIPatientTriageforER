import React, { useEffect, useState } from 'react';

export default function StrokeDoorToNeedlePage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/stroke-door-to-needle')
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data) return <div className="page"><h1>Stroke Door-to-Needle</h1><p>Loading stroke pathway...</p></div>;

  return (
    <div className="page">
      <h1>Stroke Door-to-Needle</h1>
      <p>Track acute stroke checkpoints from door time through CT readiness and thrombolytic eligibility.</p>
      <div className="stats-grid">
        {Object.entries(data.summary).map(([key, value]) => (
          <div className="stat-card" key={key}><h3>{value}</h3><p>{key.replace(/([A-Z])/g, ' $1')}</p></div>
        ))}
      </div>
      <section className="card">
        <h2>Patient Pathway</h2>
        {data.patients.map((patient) => (
          <div className="activity-item" key={patient.encounter}>
            <strong>{patient.encounter} - NIHSS {patient.nihss}</strong>
            <p>Last known well {patient.lastKnownWell}; blocker: {patient.blocker}</p>
            <small>{patient.action}</small>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Checkpoints</h2>
        <p>{data.checkpoints.join(' -> ')}</p>
      </section>
    </div>
  );
}

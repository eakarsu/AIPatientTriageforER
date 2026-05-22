const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    feature: 'Stroke Door-to-Needle',
    summary: { suspectedStrokes: 5, ctReady: 3, thrombolyticEligible: 2, averageDoorToCt: 14 },
    patients: [
      { encounter: 'ER-8841', lastKnownWell: '42 min', nihss: 9, blocker: 'none', action: 'Activate stroke team and reserve CT now' },
      { encounter: 'ER-8860', lastKnownWell: '71 min', nihss: 5, blocker: 'anticoagulant history pending', action: 'Confirm medication list before lytic decision' },
      { encounter: 'ER-8872', lastKnownWell: 'unknown', nihss: 12, blocker: 'wake-up stroke', action: 'MRI mismatch pathway consult' }
    ],
    checkpoints: ['Door time', 'Glucose resulted', 'CT start', 'ICH excluded', 'Consent/contraindications', 'Needle time']
  });
});

module.exports = router;

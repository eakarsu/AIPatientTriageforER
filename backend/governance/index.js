'use strict';
const { createRouter } = require('./router');
const { sequelize } = require('./store');
const { evaluate } = require('./domain');
const database = require('../config/database');
const auth = require('../middleware/auth');

module.exports = createRouter({
  db: sequelize(database), auth, evaluate, workflow: 'er-triage',
  providers: ['ehr-fhir','laboratory','imaging','device','pharmacy','scheduling','payer','ems'],
  approverRoles: ['triage_nurse','emergency_physician','clinical_reviewer','privacy_officer','admin']
});

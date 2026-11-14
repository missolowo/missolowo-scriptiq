// Production data isolation. Extracts the REAL functions out of app.html
// and drives them against a fake localStorage, so this fails if the
// shipped code stops doing what it claims.
// Paths resolve from the repository root, so these run from any clone.
const __p = require('path');
const ROOT = __p.resolve(__dirname, '..');
const APP_PATH = __p.join(ROOT, 'app.html');
const SCHEDULE_PATH = __p.join(ROOT, 'netlify', 'functions', 'schedule.js');

const fs = require('fs');
const APP = fs.readFileSync(APP_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  PASS  ' + n))
                          : (fail++, console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')));
function block(needle) {
  const s = APP.indexOf(needle);
  if (s < 0) { console.error('NOT FOUND: ' + needle); process.exit(1); }
  let d = 0, end = -1;
  for (let j = APP.indexOf('{', s); j < APP.length; j++) {
    if (APP[j] === '{') d++;
    else if (APP[j] === '}') { d--; if (d === 0) { end = j + 1; break; } }
  }
  return APP.slice(s, end);
}

const src = [
  block('function slateDetailsKey'),
  block('function slateDefaultProductionDetails'),
  'var slateProductionDetails = slateDefaultProductionDetails();',
  block('function loadProductionDetails'),
  block('function saveProductionDetails')
].join('\n');

function harness() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const win = { slateProductionId: null };
  const fields = {};
  const document = {
    getElementById: id => (id === 'pdSaveStatus' ? { textContent: '' }
                                                 : { value: fields[id] == null ? '' : fields[id] })
  };
  const build = new Function('localStorage', 'window', 'document', 'setTimeout',
    src + '; return { key: slateDetailsKey, defaults: slateDefaultProductionDetails,'
        + ' load: loadProductionDetails, save: saveProductionDetails,'
        + ' get pd() { return slateProductionDetails; } };');
  const api = build(localStorage, win, document, () => {});
  return { api, win, fields, store };
}

console.log('\nThe key');
let h = harness();
h.win.slateProductionId = 'prod-A';
ok('key carries the production id', h.api.key() === 'slate_production_details:prod-A', h.api.key());
h.win.slateProductionId = null;
ok('no production yet -> its own bucket, never the shared one',
   h.api.key() === 'slate_production_details:unsaved', h.api.key());
ok('the old global key is gone from the source',
   !/localStorage\.(get|set)Item\('slate_production_details'\)/.test(APP));

console.log('\nDefaults');
h = harness();
const d1 = h.api.defaults(), d2 = h.api.defaults();
ok('returns a NEW object each call', d1 !== d2);
ok('arrays are not shared between copies', d1.crew !== d2.crew && d1.safety_notes !== d2.safety_notes);
d1.crew.push({ role: 'Gaffer', name: 'X' });
ok('mutating one copy cannot reach another', d2.crew.length === 0, JSON.stringify(d2.crew));
ok('the standard safety notes do default in', d2.safety_notes.length >= 5);

console.log('\nTwo productions, which is the whole point');
h = harness();
h.win.slateProductionId = 'prod-A';
h.fields.pdHospital = 'Lagoon Hospital, Ikeja';
h.fields.pdCrew = 'Gaffer|Tunde|080111\nGrip|Ada|080222';
h.fields.pdCastHotel = 'Eko Hotel';
h.fields.pdEmergency = 'Medic|Sade|080333';
h.api.save();
ok('A saved under its own key',
   h.store.has('slate_production_details:prod-A'), [...h.store.keys()].join());

h.win.slateProductionId = 'prod-B';
h.api.load();
ok('B does NOT see A\'s hospital', h.api.pd.hospital === '', h.api.pd.hospital);
ok('B does NOT see A\'s crew', h.api.pd.crew.length === 0, JSON.stringify(h.api.pd.crew));
ok('B does NOT see A\'s hotel', h.api.pd.cast_hotel === '', h.api.pd.cast_hotel);
ok('B does NOT see A\'s emergency contacts', h.api.pd.emergency_contacts.length === 0);
ok('B still gets the standard safety notes', h.api.pd.safety_notes.length >= 5);

h.fields.pdHospital = 'Reddington, Victoria Island';
h.fields.pdCrew = '';
h.fields.pdCastHotel = '';
h.fields.pdEmergency = '';
h.api.save();

h.win.slateProductionId = 'prod-A';
h.api.load();
ok('going back to A, A\'s hospital survived', h.api.pd.hospital === 'Lagoon Hospital, Ikeja', h.api.pd.hospital);
ok('going back to A, A\'s crew survived', h.api.pd.crew.length === 2, JSON.stringify(h.api.pd.crew));
ok('  ...and B\'s hospital did not follow', h.api.pd.hospital !== 'Reddington, Victoria Island');

console.log('\nThe leak this fixes: a field B never filled in');
h = harness();
h.win.slateProductionId = 'prod-A';
h.fields.pdBaseCamp = 'Behind the Baale compound, Epe';
h.fields.pdHospital = 'Lagoon Hospital';
h.api.save();
h.win.slateProductionId = 'prod-B';
h.api.load();
ok('B\'s base camp is empty, not A\'s', h.api.pd.base_camp === '', h.api.pd.base_camp);
ok('a call sheet for B would carry no address at all rather than the wrong one',
   h.api.pd.base_camp === '' && h.api.pd.hospital === '');

console.log('\nA brand new production');
h = harness();
h.win.slateProductionId = 'prod-A';
h.fields.pdHospital = 'Lagoon Hospital';
h.fields.pdCrew = 'Gaffer|Tunde|080111';
h.api.save();
h.win.slateProductionId = null;   // slateNewProduction clears it
h.api.load();
ok('new production starts clean', h.api.pd.hospital === '' && h.api.pd.crew.length === 0);
ok('  ...with the safety notes still there', h.api.pd.safety_notes.length >= 5);
ok('  ...and A is untouched on disk', h.store.has('slate_production_details:prod-A'));

console.log('\nWiring');
ok('openProduction reloads details after switching production',
   /slateProductionId = data\.production\.production_id;[\s\S]{0,420}slateLoadProductionDetails/.test(APP));
ok('slateNewProduction resets details',
   /slateScriptTitle = null;[\s\S]{0,500}slateLoadProductionDetails/.test(APP));
ok('load resets to defaults before overlaying',
   /slateDefaultProductionDetails\(\);[\s\S]{0,300}delete slateProductionDetails/.test(block('function loadProductionDetails')));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

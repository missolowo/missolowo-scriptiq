#!/usr/bin/env node
// Run every test. `node tests/run.js` from the repository root.
//
// Exits non-zero if anything fails, so it can gate a deploy.
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HERE = __dirname;
const PROBES = [
  'retry-probe',       // a dropped connection mid-breakdown
  'isolation-probe',   // one production's details never reach another
  'derive-probe',      // everything that follows from a day assignment
  'assign-probe',      // accepting (and refusing) an assignment
  'move-probe',        // what the workspace sends when a scene moves
  'compromise-probe',  // advisories that report and never act
  'pricing-probe',     // the three copies of a price still agree
  'resume-probe',      // an interrupted breakdown carries on, charged once
  'copy-probe',        // what we promise filmmakers, in the words they read
  'prompt-probe',      // what we pay the model for, and what we derive
  'merge-probe',       // the merge actually run: are the derived lists right
  'numbering-probe',   // what the # means, and whether we say so
  'cast-probe',        // who is one person, who is two, who is not a person
  'korean-probe',      // a heading with no INT/EXT word in it at all
  'scenenumber-probe', // a number alone on a line: whose is it, if anyone's
  'align-probe',       // the model's scenes matched to the script's own headings
  'funnel-probe',      // where the 233 who did not get a breakdown went
  'language-probe',    // one name per language, wherever it is written
  'charge-probe',      // the credit is claimed before it is taken
  'subscribe-probe',   // the signup-to-MailerLite hook, and its isolation
  'subscribe-run'      // that hook, actually run against a failing provider
];

let total = 0, failed = 0, broken = [];

for (const name of PROBES) {
  const file = path.join(HERE, name + '.js');
  if (!fs.existsSync(file)) { console.log(name.padEnd(20) + 'MISSING'); failed++; broken.push(name); continue; }
  let out = '', ok = true;
  try { out = execFileSync(process.execPath, [file], { encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); ok = false; }
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) {
    total += Number(m[1]);
    failed += Number(m[2]);
    if (Number(m[2])) broken.push(name);
    console.log(name.padEnd(20) + m[1] + ' passed, ' + m[2] + ' failed');
  } else {
    failed++; broken.push(name);
    console.log(name.padEnd(20) + 'ERROR');
    console.log(out.split('\n').filter(Boolean).slice(-4).map(l => '    ' + l).join('\n'));
  }
  if (!ok && m && !Number(m[2])) { failed++; broken.push(name); }
}

console.log('\n' + total + ' assertions passed, ' + failed + ' failed');
if (broken.length) console.log('failing: ' + broken.join(', '));
console.log('\nBrowser checks (need playwright):');
console.log('  node tests/page-load.js        every page loads');
console.log('  node tests/resume-browser.js   the resume offer at phone width');
console.log('  node tests/funnel-browser.js   the funnel events actually fire');
console.log('  node tests/homepage-browser.js how far down the homepage people get');
console.log('  node tests/pagefurniture-browser.js  page numbers are not scene numbers');
console.log('  node tests/layout-browser.js   a PDF page is a layout, not a stream');
process.exit(failed ? 1 : 0);

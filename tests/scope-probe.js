// A function is only callable inside the function that declares it.
//
//   node tests/scope-probe.js [file]
//
// On 25 November "Generate schedule" stopped with "slateOpeningWord is not
// defined". The function was declared INSIDE slateHealthCheck, and the
// montage setups in schedule generation called it from outside. Every probe
// passed, because the probes paste the functions they test side by side in
// one scope — exactly the arrangement the browser does not have.
//
// This reads app.html's own structure instead: for every function declared
// inside another function, every call to it must sit inside that same
// enclosing function — unless the name is also declared or assigned
// somewhere the caller can see (window.x = …, var x, another declaration).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = process.argv[2] ? [process.argv[2]] : [path.join(ROOT, 'app.html')].concat(
  fs.readdirSync(path.join(ROOT, 'netlify/functions')).filter(f => f.endsWith('.js'))
    .map(f => path.join(ROOT, 'netlify/functions', f)));
let pass = 0, fail = 0;
FILES.forEach(file => {
const src = fs.readFileSync(file, 'utf8');

// Blank out comments, strings and regex literals so braces inside them do
// not count. Lengths are preserved, so offsets still match the source.
function mask(t) {
  const out = t.split('');
  let i = 0, prev = '';
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < t.length) {
    const c = t[i], n = t[i + 1];
    if (c === '/' && n === '/') { const e = t.indexOf('\n', i); const end = e < 0 ? t.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = t.indexOf('*/', i + 2) + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < t.length && t[j] !== c) { if (t[j] === '\\') j++; if (c !== '`' && t[j] === '\n') break; j++; }
      blank(i + 1, j); i = j + 1; prev = c; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$|return$/.test(prev)) {
      let j = i + 1, cls = false;
      while (j < t.length && t[j] !== '\n') {
        if (t[j] === '\\') { j += 2; continue; }
        if (t[j] === '[') cls = true; else if (t[j] === ']') cls = false;
        else if (t[j] === '/' && !cls) break;
        j++;
      }
      if (t[j] === '/') { blank(i + 1, j); i = j + 1; prev = '/'; continue; }
    }
    if (!/\s/.test(c)) prev = /[A-Za-z0-9_$]/.test(c) ? (/[A-Za-z0-9_$]/.test(prev) ? prev + c : c) : c;
    if (prev.length > 6) prev = prev.slice(-6);
    i++;
  }
  return out.join('');
}

// An HTML page: only its inline scripts. A .js file: all of it.
let m, M;
if (/\.js$/.test(file)) M = mask(src);
else {
  const masked = src.split('').fill(' ').join('').split('');
  const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  while ((m = scriptRe.exec(src))) {
    const start = m.index + m[0].indexOf('>') + 1;
    const body = mask(m[1]);
    for (let k = 0; k < body.length; k++) masked[start + k] = body[k];
  }
  M = masked.join('');
}

// Every { … } span, and which function header opened it.
const stack = [], fnSpans = [];
for (let i = 0; i < M.length; i++) {
  if (M[i] === '{') {
    const head = M.slice(Math.max(0, i - 200), i);
    const isFn = /function\s*[A-Za-z0-9_$]*\s*\([^()]*\)\s*$/.test(head) || /=>\s*$/.test(head);
    stack.push({ at: i, isFn });
  } else if (M[i] === '}') {
    const o = stack.pop();
    if (o && o.isFn) fnSpans.push([o.at, i]);
  }
}
function enclosingFn(pos) {
  let best = null;
  fnSpans.forEach(sp => { if (sp[0] < pos && pos < sp[1] && (!best || sp[0] > best[0])) best = sp; });
  return best;
}
const lineOf = pos => src.slice(0, pos).split('\n').length;

const declRe = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
const decls = {};
while ((m = declRe.exec(M))) (decls[m[1]] = decls[m[1]] || []).push(m.index);

Object.keys(decls).forEach(name => {
  const scopes = decls[name].map(enclosingFn);
  // Declared at the top of a script somewhere, or published on window: visible everywhere.
  if (scopes.some(s => !s)) return;
  if (new RegExp('window\\.' + name.replace(/\$/g, '\\$') + '\\s*=').test(M)) return;
  if (new RegExp('\\b(?:var|let|const)\\s+' + name.replace(/\$/g, '\\$') + '\\b').test(M)) return;
  const useRe = new RegExp('(^|[^\\w$.])' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
  let u;
  while ((u = useRe.exec(M))) {
    const pos = u.index + u[1].length;
    if (/function\s+$/.test(M.slice(Math.max(0, pos - 12), pos))) continue;
    const seen = scopes.some(s => s[0] < pos && pos < s[1]);
    if (seen) pass++;
    else { fail++; console.log('  FAIL ' + path.basename(file) + ': ' + name + '() called at line ' + lineOf(pos) + ', but declared inside the function at line ' + scopes.map(s => lineOf(s[0])).join(', ') + ' — it does not exist there'); }
  }
});
});

console.log('scope-probe         ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

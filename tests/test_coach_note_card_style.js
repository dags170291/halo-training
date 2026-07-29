// Regression test: Dylon: "the coaches note is just floating give it some style please." The
// .coach-note block (shared by the week-detail panel's Coach note, a session's own coach note, and
// Race Day Strategy's mindset note) used to set background:var(--s2) with no border -- in the light
// theme, --s2 (#F7F8FA) sits almost indistinguishable from --bg (#F4F5F7), so the note rendered as
// plain unbounded text instead of a card. Fixed by giving it the same treatment as .card: background
// var(--s1) (a real, distinct surface color in both themes) plus a 1px var(--b1) border.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'halotraining-app', 'index.html'), 'utf8');

// ---- Test 1: the .coach-note CSS rule now sets a distinct background (var(--s1), matching .card)
// and a real border, not the old near-invisible var(--s2) with no border ----
const ruleMatch = html.match(/\.coach-note\{([^}]*)\}/);
const rule = ruleMatch ? ruleMatch[1] : '';
const hasS1Background = /background:var\(--s1\)/.test(rule);
const hasBorder = /border:1px solid var\(--b1\)/.test(rule);
const noLongerUsesS2 = !/background:var\(--s2\)/.test(rule);
console.log('Test 1 (.coach-note CSS rule has a distinct card background + border, not the old blended background):', {
  rule, hasS1Background, hasBorder, noLongerUsesS2,
  result: (hasS1Background && hasBorder && noLongerUsesS2) ? 'PASS' : 'FAIL'
});

// ---- Test 2: .card itself still uses the same var(--s1) background + var(--b1) border, confirming
// .coach-note now visually matches every other card in the app rather than introducing a one-off style ----
const cardRuleMatch = html.match(/\.card\{([^}]*)\}/);
const cardRule = cardRuleMatch ? cardRuleMatch[1] : '';
const cardMatches = /background:var\(--s1\)/.test(cardRule) && /border:1px solid var\(--b1\)/.test(cardRule);
console.log('Test 2 (.coach-note\\u2019s new background/border match .card\\u2019s own, so it reads as a consistent card):',
  cardMatches ? 'PASS' : 'FAIL', { cardRule });

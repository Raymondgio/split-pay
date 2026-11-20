import { loadCore, split, balances, balancesConverted } from './core.js';
import { kvGet, kvPut, photoGet, photoPut, photoDel, photoAll, photoReplaceAll, compressImage, summaryImage, shareFile } from './media.js';
import { sync, initSync, start, refresh, warm, signIn, logIn, createAccount, resetPassword, signOut, schedulePush, fetchPhoto, backupOnline, listBackups, loadBackup, shareGroup, inviteLink, joinGroup, claimName, addMeTo, claimedHere } from './sync.js';

// ------------------------------------------------------------ constants
const APP_VERSION = '1.2.0';
const CUR = { IDR: 0, SGD: 2, MYR: 2, THB: 2, CNY: 2, JPY: 0 };
const BASE = 'IDR'; // exchange rates are typed as "1 X = ? IDR"
const TYPES = { Trip: '🏝️', Home: '🏠', Couple: '💞', Other: '👥' };
const DEFAULT_CATS = [['🧾', 'General'], ['🍽️', 'Food'], ['🥤', 'Drinks'], ['🛵', 'Transport'], ['🏠', 'Stay'], ['🎲', 'Fun'], ['🛍️', 'Shopping'], ['📦', 'Other']].map(([e, n]) => ({ e, n }));
const COLORS = ['#8AB4FF', '#FFB5D0', '#FFD27A', '#B9A6FF', '#7FE0C3', '#FF9F80', '#A8E06A', '#F2A0FF', '#9AD8FF', '#FFC46B'];
const METHODS = [['equal', 'Equal', 'equally'], ['exact', 'Exact', 'by exact amounts'], ['percent', '%', 'by percentages'], ['shares', 'Shares', 'by shares'], ['adjust', 'Adjust', 'by adjustment']];
const REPEATS = { none: 'Does not repeat', weekly: 'Every week', fortnightly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };
const LOCK_AFTER_MS = 60_000;

const I = {
  back: '<svg class="i" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  gear: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  groups: '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.3"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15.5 14.2c3 0 5.5 1.6 5.5 4.3"/></svg>',
  friends: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>',
  activity: '<svg class="i" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  account: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1-2.3 3-3.5 5.5-3.5s4.5 1.2 5.5 3.5"/></svg>',
};

// ---------------------------------------------------------------- state
let S = null; // saved data
const ui = { draft: null, locked: false, hiddenAt: 0, viewer: null, q: '', tot: {}, conv: {},
  auth: { mode: 'login', email: '', password: '', password2: '', err: '', info: '', busy: false }, afterLogin: '',
  bk: { busy: false, list: null, err: '' } };
const $app = document.getElementById('app');

async function saveQuiet() { await kvPut('state', S); }
async function saveState() { await kvPut('state', S); if (S?.sync?.uid) schedulePush(); }
async function commit() { await saveState(); render(); }
/** Re-draw after a change from a friend, but never under someone's fingers while they type. */
function softRender() {
  const h = location.hash;
  const busy = /^#\/(expense|payment|new-group)/.test(h) || /\/(set|wb)$/.test(h) || document.activeElement?.matches?.('input, textarea, select');
  if (!busy) render();
}

/** Fill in fields added after version 1.0, so older data keeps working. */
function migrate(s) {
  s.settings = { theme: 'dark', currency: 'IDR', ...s.settings };
  s.settings.categories ||= structuredClone(DEFAULT_CATS);
  s.settings.presets ||= [];
  s.settings.rates ||= {};
  s.settings.lock ??= null;
  for (const g of s.groups) { g.whiteboard ??= ''; g.tripStart ??= ''; g.tripEnd ??= ''; }
  for (const e of s.expenses) { e.repeat ??= 'none'; e.photoId ??= null; }
  let ng = s.groups.find((g) => g.nongroup);
  if (!ng) {
    ng = { id: crypto.randomUUID(), name: 'Non-group expenses', type: 'Other', nongroup: true, memberIds: [], simplify: false, whiteboard: '', tripStart: '', tripEnd: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deleted: false };
    s.groups.push(ng);
  }
  for (const p of s.people) if (!ng.memberIds.includes(p.id)) ng.memberIds.push(p.id);
  s.sync ||= { uid: null, pushed: {} };
  s.sync.pushed ||= {};
  s.version = 2;
  return s;
}

// -------------------------------------------------------------- helpers
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const person = (id) => S.people.find((p) => p.id === id) || { id, name: 'Someone', color: '#888' };
const nm = (id) => (id === S.me ? 'You' : person(id).name);
const group = (id) => S.groups.find((g) => g.id === id && !g.deleted);
const liveGroups = () => S.groups.filter((g) => !g.deleted);
const realGroups = () => liveGroups().filter((g) => !g.nongroup);
const nonGroup = () => S.groups.find((g) => g.nongroup);
const friends = () => S.people.filter((p) => p.id !== S.me);
const catName = (e) => S.settings.categories.find((c) => c.e === e)?.n || 'Other';
const groupTitle = (g) => (g.nongroup ? 'Non-group expenses' : g.name);

function fmt(amount, cur) {
  const d = CUR[cur] ?? 2;
  return `${cur} ${(Math.abs(amount) / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
const plain = (amount, cur) => (amount / 10 ** (CUR[cur] ?? 2)).toFixed(CUR[cur] ?? 2);
function parseAmt(str, cur) {
  const n = parseFloat(String(str ?? '').replace(/,/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n * 10 ** (CUR[cur] ?? 2));
}
const toInput = (amount, cur) => (amount ? String(amount / 10 ** (CUR[cur] ?? 2)) : '');
const av = (id, cls = '') => { const p = person(id); return `<div class="av ${cls}" style="background:${esc(p.color)}">${esc((p.name || '?').trim()[0]?.toUpperCase() || '?')}</div>`; };
const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
const curOpts = (sel) => Object.keys(CUR).map((c) => opt(c, c, sel)).join('');
const shortDate = (s) => new Date(s + 'T00:00').toLocaleString('en-GB', { day: 'numeric', month: 'short' });
const tripText = (g) => (g.tripStart ? ` · ${shortDate(g.tripStart)}${g.tripEnd ? `–${shortDate(g.tripEnd)}` : ''}` : '');

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function log(text) {
  S.activity.unshift({ id: uid(), ts: nowIso(), text });
  if (S.activity.length > 300) S.activity.length = 300;
}
function addPerson(name) {
  const clean = name.trim();
  if (!clean) return null;
  const found = friends().find((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const p = { id: uid(), name: clean, color: COLORS[(S.people.length - 1) % COLORS.length], updatedAt: nowIso() };
  S.people.push(p);
  nonGroup().memberIds.push(p.id);
  return p;
}
const go = (hash) => { location.hash = hash; };
const back = () => history.back();

// ------------------------------------------------------- balance helpers
function groupReq(g) {
  return {
    expenses: S.expenses.filter((e) => e.groupId === g.id && !e.deleted).map((e) => ({ currency: e.currency, payers: e.payers, shares: e.shares })),
    payments: S.payments.filter((p) => p.groupId === g.id && !p.deleted).map((p) => ({ currency: p.currency, from: p.from, to: p.to, amount: p.amount })),
    simplify: !!g.simplify,
  };
}
function groupBal(g) { const r = balances(groupReq(g)); return r.ok ? r.data : []; }
function fxFor(target) {
  const rates = { [BASE]: 1_000_000 };
  for (const c of Object.keys(CUR)) {
    const v = parseFloat(String(S.settings.rates[c] ?? '').replace(/,/g, ''));
    if (c !== BASE && isFinite(v) && v > 0) rates[c] = Math.round(v * 1_000_000);
  }
  return { target, rates, decimals: CUR };
}
function groupBalConverted(g) { return balancesConverted({ ...groupReq(g), fx: fxFor(S.settings.currency) }); }
// debts that involve me: [{other, cur, amount}]  amount > 0 = they owe me
function myLines(bal) {
  const out = [];
  for (const c of bal) for (const d of c.debts) {
    if (d.to === S.me) out.push({ other: d.from, cur: c.currency, amount: d.amount });
    else if (d.from === S.me) out.push({ other: d.to, cur: c.currency, amount: -d.amount });
  }
  return out;
}
function myNets(bal) {
  const out = {};
  for (const c of bal) { const n = c.nets.find((x) => x.id === S.me); if (n) out[c.currency] = n.amount; }
  return out;
}
const debtText = (from, to, amount, cur) =>
  from === S.me ? `You owe ${esc(nm(to))} <span class="neg">${fmt(amount, cur)}</span>`
    : to === S.me ? `${esc(nm(from))} owes you <span class="pos">${fmt(amount, cur)}</span>`
      : `${esc(nm(from))} owes ${esc(nm(to))} <span>${fmt(amount, cur)}</span>`;
const debtPlain = (from, to, amount, cur) => `${person(from).name} owes ${person(to).name} ${fmt(amount, cur)}`;
function netsHtml(nets, zeroText) {
  const keys = Object.keys(nets).filter((c) => nets[c] !== 0);
  if (!keys.length) return `<div class="end mut"><b>${zeroText}</b></div>`;
  return `<div class="end">${keys.map((c) => `<span class="${nets[c] > 0 ? 'pos' : 'neg'}">${nets[c] > 0 ? 'you are owed' : 'you owe'}<b>${fmt(nets[c], c)}</b></span>`).join('')}</div>`;
}
const hasItems = (g) => S.expenses.some((e) => e.groupId === g.id && !e.deleted) || S.payments.some((p) => p.groupId === g.id && !p.deleted);

// ------------------------------------------------------------- repeats
function addInterval(dateStr, rep, anchor) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (rep === 'weekly' || rep === 'fortnightly') {
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() + (rep === 'weekly' ? 7 : 14));
    return t.toISOString().slice(0, 10);
  }
  const mi = m - 1 + (rep === 'monthly' ? 1 : 12);
  const ny = y + Math.floor(mi / 12), nmo = mi % 12;
  const dim = new Date(Date.UTC(ny, nmo + 1, 0)).getUTCDate();
  return `${ny}-${String(nmo + 1).padStart(2, '0')}-${String(Math.min(anchor || d, dim)).padStart(2, '0')}`;
}
/** Same input → same ID, so two phones that both make a repeat copy make the same one. */
function stableId(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822507); h4 = Math.imul(h4 ^ c, 3266489909);
  }
  return 'r' + [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
/** Create the copies of repeating expenses that are due. The repeat moves to the newest copy. */
function runRepeats() {
  let made = 0;
  const t = today();
  for (const e of [...S.expenses]) {
    if (e.deleted || !e.repeat || e.repeat === 'none') continue;
    let cur = e, n = 0, next = addInterval(cur.date, cur.repeat, cur.repeatDay);
    while (next <= t && n < 60) {
      const id = stableId(`${cur.id}|${next}`);
      if (S.expenses.some((x) => x.id === id)) { cur.repeat = 'none'; cur.updatedAt = nowIso(); break; }
      const copy = { ...structuredClone(cur), id, date: next, createdAt: nowIso(), updatedAt: nowIso(), photoId: null };
      cur.repeat = 'none'; cur.updatedAt = nowIso();
      S.expenses.push(copy);
      cur = copy; n++;
      next = addInterval(cur.date, cur.repeat, cur.repeatDay);
    }
    if (n) { made += n; log(`Repeating “${e.desc}” was added ${n === 1 ? 'again' : `${n} times`} in “${groupTitle(group(e.groupId) || {})}”.`); }
  }
  return made;
}

// ------------------------------------------------------------- screens
function tabs(on) {
  const t = [['groups', 'Groups', '#/'], ['friends', 'Friends', '#/friends'], ['activity', 'Activity', '#/activity'], ['account', 'Account', '#/account']];
  return `<nav class="tabs">${t.map(([k, label, h]) => `<button class="${k === on ? 'on' : ''}" data-act="go" data-to="${h}">${I[k]}${label}</button>`).join('')}</nav>`;
}
const fab = (gid = '') => `<button class="fab" data-act="new-expense" data-gid="${gid}" aria-label="Add expense">+</button>`;
const topBack = (title, right = '<span style="width:28px"></span>', icon = I.back) =>
  `<div class="top center"><button class="icon-btn" data-act="back" aria-label="Back">${icon}</button><h1>${title}</h1>${right}</div>`;

/** Step 2 after log-in on a phone with no data: type your name, or bring back an online backup. */
function vOnboard() {
  const invited = location.hash.startsWith('#/join/');
  if (ui.bk.list === null && !ui.bk.loading) {
    ui.bk.loading = true;
    listBackups().then((l) => { ui.bk.list = l; }).catch(() => { ui.bk.list = []; }).finally(() => { ui.bk.loading = false; render(); });
  }
  const latest = ui.bk.list?.[0];
  return `<div class="page"><div style="height:12vh"></div>
    <h2 class="title">Welcome to<br><span class="pos">Split Pay</span></h2>
    <p class="mut" style="margin:10px 0 22px">${invited ? 'A friend invited you to a group. First, type your name.' : 'Split costs with friends. No ads. Your data stays on this phone; only groups you share go online.'}</p>
    ${latest ? `<div class="card"><b>You have an online backup</b><p class="hint" style="text-align:left;margin:4px 0 10px">${new Date(latest.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${latest.expenses ?? '?'} expenses · ${latest.groups ?? '?'} groups</p>
      <button class="btn" data-act="restore-online" data-id="${esc(latest.id)}" ${ui.bk.busy ? 'disabled' : ''}>${ui.bk.busy ? 'Restoring…' : 'Restore it'}</button></div>
      <div class="lbl" style="margin-top:18px">Or start fresh: your name</div>` : '<div class="lbl">Your name</div>'}
    <input class="input" id="ob-name" placeholder="e.g. Raymond" autocomplete="off" maxlength="30">
    <div class="bottom"><button class="btn ${latest ? 'ghost' : ''}" data-act="onboard">Start</button></div>
    <p class="hint" style="margin-top:14px">Logged in as ${esc(sync.user?.email || '')} · <button class="link" data-act="sign-out">Log out</button></p></div>`;
}
/** Step 1: nobody may use the app without logging in. */
function vGate() {
  const invited = location.hash.startsWith('#/join/');
  if (invited && !ui.gateSet) { ui.gateSet = true; ui.auth.mode = 'signup'; }
  return `<div class="page"><div style="height:7vh"></div>
    <div class="center"><img src="icons/icon.svg" alt="" width="64" height="64" style="border-radius:16px"></div>
    <p class="mut center" style="margin:10px 0 4px">${invited ? 'A friend invited you to a shared group on Split Pay.' : 'Split costs with friends. No ads.'}</p>
    ${authForm()}</div>`;
}
function vNoConnection() {
  return `<div class="page"><div style="height:20vh"></div>
    <h2 class="title center">No internet</h2>
    <p class="mut center" style="margin:10px 0 22px">Split Pay needs the internet the first time, to log in. After that it also works offline.</p>
    <button class="btn" data-act="reload">Try again</button></div>`;
}
function vOtherAccount() {
  return `<div class="page"><div style="height:12vh"></div>
    <h2 class="title">This phone has someone else's data</h2>
    <p class="mut" style="margin:10px 0 22px">The expenses on this phone belong to a different account than ${esc(sync.user?.email || '')}. Log out so the owner can log in again, or erase this phone's data to use your account here.</p>
    <button class="btn" data-act="sign-out">Log out</button>
    <button class="btn danger" style="margin-top:12px" data-act="erase-local">Erase this phone's data</button>
    <p class="hint" style="margin-top:12px">Erasing does not touch shared groups or online backups.</p></div>`;
}

function vLock() {
  const bio = S.settings.lock?.bio && window.PublicKeyCredential;
  return `<div class="page"><div style="height:16vh"></div>
    <div class="center"><img src="icons/icon.svg" alt="" width="72" height="72" style="border-radius:18px"></div>
    <h2 class="title center" style="margin-top:18px">Split Pay is locked</h2>
    <div class="lbl center">Enter your PIN</div>
    <input class="input center pin" id="lock-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8">
    <div class="hint err" id="lock-err"></div>
    <button class="btn" style="margin-top:14px" data-act="unlock">Unlock</button>
    ${bio ? `<button class="btn ghost" style="margin-top:10px" data-act="unlock-bio">Use fingerprint</button>` : ''}
    <button class="link center" style="margin-top:26px" data-act="forgot-pin">Forgot PIN?</button></div>`;
}

function vGroups() {
  const gs = realGroups(), ng = nonGroup();
  const total = {};
  const add = (nets) => { for (const c in nets) total[c] = (total[c] || 0) + nets[c]; };
  const cards = gs.map((g) => {
    const nets = myNets(groupBal(g)); add(nets);
    return `<button class="row" data-act="go" data-to="#/g/${g.id}"><div class="tile">${TYPES[g.type] || '👥'}</div>
      <div class="mid"><b>${esc(g.name)}</b><small>${g.memberIds.length} people · ${esc(g.type)}${g.shared ? ' · shared' : ''}${tripText(g)}</small></div>${netsHtml(nets, 'settled up')}</button>`;
  }).join('');
  const ngNets = myNets(groupBal(ng)); add(ngNets);
  const ngRow = friends().length || hasItems(ng)
    ? `<button class="row" data-act="go" data-to="#/g/${ng.id}"><div class="tile">👤</div><div class="mid"><b>Non-group expenses</b><small>With friends, outside any group</small></div>${netsHtml(ngNets, 'settled up')}</button>` : '';
  const keys = Object.keys(total).filter((c) => total[c] !== 0).sort((a, b) => Math.abs(total[b]) - Math.abs(total[a]));
  const line = (c) => `${total[c] > 0 ? 'you are owed' : 'you owe'} ${fmt(total[c], c)}`;
  const hero = !keys.length
    ? `<div class="hero"><div class="small">Overall</div><div class="big">All settled up</div></div>`
    : `<div class="hero"><div class="small">Overall, ${total[keys[0]] > 0 ? 'you are owed' : 'you owe'}</div>
       <div class="big ${total[keys[0]] > 0 ? 'pos' : 'neg'}">${fmt(total[keys[0]], keys[0])}</div>
       ${keys.slice(1).map((c) => `<div class="sub ${total[c] > 0 ? 'pos' : 'neg'}">and ${line(c)}</div>`).join('')}</div>`;
  const canAdd = gs.length || friends().length;
  return `<div class="page"><div class="top"><h1>Split Pay</h1>
      <button class="icon-btn" data-act="go" data-to="#/search" aria-label="Search">${I.search}</button>
      <button class="icon-btn right" data-act="new-group" aria-label="New group">${I.plus}</button></div>
    ${hero}<div class="lbl">Groups</div>
    ${cards || `<div class="empty"><b>No groups yet</b>Create a group, add your friends, then add the first expense.</div>`}
    ${ngRow}
    <button class="btn ghost" style="margin-top:18px" data-act="new-group">+ Create a group</button>
    </div>${canAdd ? fab() : ''}${tabs('groups')}`;
}

function rowHtml(it, withGroup = false) {
  const d = new Date(it.date + 'T00:00');
  const date = `<div class="date">${d.toLocaleString('en-US', { month: 'short' })}<b>${d.getDate()}</b></div>`;
  const gname = withGroup ? ` · ${esc(groupTitle(group(it.groupId) || {}))}` : '';
  if (it.kind === 'p') {
    const p = it.p;
    return `<button class="row pay" data-act="edit-payment" data-id="${p.id}">${date}<div class="tile">💸</div>
      <div class="mid"><b>${esc(nm(p.from))} paid ${esc(p.to === S.me ? 'you' : nm(p.to))}</b><small>Payment${gname}</small></div><div class="end mut"><b>${fmt(p.amount, p.currency)}</b></div></button>`;
  }
  const e = it.e;
  const paid = e.payers.find((x) => x.id === S.me)?.amount || 0;
  const owed = e.shares.find((x) => x.id === S.me)?.amount || 0;
  const diff = paid - owed;
  const end = !(paid || owed) ? `<div class="end mut">not involved</div>`
    : diff > 0 ? `<div class="end pos">you lent<b>${fmt(diff, e.currency)}</b></div>`
      : diff < 0 ? `<div class="end neg">you borrowed<b>${fmt(diff, e.currency)}</b></div>` : `<div class="end mut">no balance</div>`;
  const who = e.payers.length === 1 ? `${nm(e.payers[0].id)} paid` : `${e.payers.length} people paid`;
  const marks = `${e.repeat !== 'none' ? ' · ↻' : ''}${e.photoId ? ' · 📷' : ''}`;
  return `<button class="row" data-act="edit-expense" data-id="${e.id}">${date}<div class="tile">${e.category || '🧾'}</div>
    <div class="mid"><b>${esc(e.desc)}</b><small>${esc(who)} ${fmt(e.amount, e.currency)}${gname}${marks}</small></div>${end}</button>`;
}
const itemsOf = (filter) => [
  ...S.expenses.filter((e) => !e.deleted && filter(e)).map((e) => ({ kind: 'e', date: e.date, at: e.createdAt, groupId: e.groupId, e })),
  ...S.payments.filter((p) => !p.deleted && filter(p)).map((p) => ({ kind: 'p', date: p.date, at: p.createdAt, groupId: p.groupId, p })),
].sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));

function vGroup(g) {
  const bal = groupBal(g);
  const lines = myLines(bal);
  const nets = myNets(bal);
  const items = itemsOf((x) => x.groupId === g.id);
  const netKeys = Object.keys(nets).filter((c) => nets[c] !== 0);
  const sum = !items.length ? '' : `<div class="sum">${netKeys.length
    ? netKeys.map((c) => `<b class="${nets[c] > 0 ? 'pos' : 'neg'}">${nets[c] > 0 ? 'You are owed' : 'You owe'} ${fmt(nets[c], c)}</b>`).join('')
    : '<b>You are settled up</b>'}${lines.map((l) => `<div>${l.amount > 0 ? debtText(l.other, S.me, l.amount, l.cur) : debtText(S.me, l.other, -l.amount, l.cur)}</div>`).join('')}</div>`;
  let lastMonth = '';
  const list = items.map((it) => {
    const month = new Date(it.date + 'T00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const head = month !== lastMonth ? `<div class="lbl">${month}</div>` : '';
    lastMonth = month;
    return head + rowHtml(it);
  }).join('');
  const sub = g.nongroup ? 'Expenses with friends, outside any group' : `${g.memberIds.length} people · ${esc(g.type)}${g.shared ? ' · shared' : ''}${tripText(g)}`;
  return `<div class="page"><div class="top"><button class="icon-btn" data-act="go" data-to="#/" aria-label="Back">${I.back}</button><span></span>
      ${g.nongroup ? '' : `<button class="icon-btn right" data-act="go" data-to="#/g/${g.id}/set" aria-label="Group settings">${I.gear}</button>`}</div>
    <h2 class="title">${esc(groupTitle(g))}</h2><div class="mut">${sub}</div>
    ${sum}
    <div class="chips"><button class="chip pri" data-act="go" data-to="#/g/${g.id}/bal">Settle up</button>
      <button class="chip" data-act="go" data-to="#/g/${g.id}/bal">Balances</button>
      <button class="chip" data-act="go" data-to="#/g/${g.id}/totals">Totals</button>
      ${g.nongroup ? '' : `<button class="chip" data-act="go" data-to="#/g/${g.id}/wb">Whiteboard</button>`}
      <button class="chip" data-act="share-summary" data-gid="${g.id}">Share</button>
      <button class="chip" data-act="export-csv" data-gid="${g.id}">Export</button></div>
    ${list || `<div class="empty"><b>No expenses yet</b>Tap + to add the first one.</div>`}
    </div>${fab(g.id)}${tabs('groups')}`;
}

function vBalances(g) {
  const conv = !!ui.conv[g.id];
  let bal = groupBal(g), convErr = '';
  if (conv) {
    const r = groupBalConverted(g);
    if (r.ok) bal = r.data;
    else convErr = r.error.startsWith('rate:') ? `Set the ${r.error.slice(5)} rate in Account → Exchange rates to see everything in ${S.settings.currency}.` : r.error;
  }
  const showConv = conv && !convErr;
  const ids = g.nongroup ? [S.me, ...g.memberIds.filter((id) => id !== S.me && bal.some((c) => c.nets.some((n) => n.id === id)))] : g.memberIds;
  const cards = ids.map((id) => {
    const totals = bal.map((c) => ({ cur: c.currency, n: c.nets.find((x) => x.id === id)?.amount || 0 })).filter((x) => x.n !== 0);
    const title = totals.length
      ? totals.map((t) => `${t.n > 0 ? (id === S.me ? 'get back' : 'gets back') : (id === S.me ? 'owe' : 'owes')} <b class="${t.n > 0 ? 'pos' : 'neg'}">${fmt(t.n, t.cur)}</b>`).join(' and ')
      : `<span class="mut">${id === S.me ? 'are' : 'is'} settled up</span>`;
    const debts = bal.flatMap((c) => c.debts.filter((d) => d.from === id || d.to === id).map((d) => ({ ...d, cur: c.currency })));
    const lines = debts.map((d) => `<div class="lines">${debtText(d.from, d.to, d.amount, d.cur)}</div>${showConv ? '' : `
      <div class="acts"><button class="chip" data-act="remind" data-gid="${g.id}" data-from="${d.from}" data-to="${d.to}" data-amount="${d.amount}" data-cur="${d.cur}">Remind</button>
      <button class="chip pri" data-act="new-payment" data-gid="${g.id}" data-from="${d.from}" data-to="${d.to}" data-amount="${d.amount}" data-cur="${d.cur}">Settle up</button></div>`}`).join('');
    return `<div class="card"><div class="head">${av(id)}<div><b>${esc(nm(id))}</b> ${title}</div></div>${lines}</div>`;
  }).join('');
  const multiCur = groupBal(g).length > 1;
  return `<div class="page sheet">${topBack('Balances')}
    <div class="mut center" style="font-size:13px">${esc(groupTitle(g))}</div>
    ${multiCur || conv ? `<button class="setrow" data-act="toggle-conv" data-gid="${g.id}"><div><b>Show all in ${S.settings.currency}</b><small>${showConv ? 'Converted with your exchange rates. Turn off to settle up.' : 'Uses the rates in Account → Exchange rates'}</small></div><div class="switch ${conv ? 'on' : ''}"></div></button>` : ''}
    ${convErr ? `<div class="hint err" style="margin-top:8px">${esc(convErr)}</div>` : ''}
    ${cards}
    ${g.nongroup ? '' : `<button class="setrow" style="margin-top:14px" data-act="toggle-simplify" data-gid="${g.id}"><div><b>Simplify debts</b><small>Fewer payments between people</small></div><div class="switch ${g.simplify ? 'on' : ''}"></div></button>`}
    <button class="btn ghost" style="margin-top:14px" data-act="new-payment" data-gid="${g.id}">Record a payment</button>
    <div class="bottom two"><button class="btn ghost" data-act="share-image" data-gid="${g.id}">As picture</button><button class="btn" data-act="share-summary" data-gid="${g.id}">Share to WhatsApp</button></div></div>`;
}

function vGroupSettings(g) {
  const used = new Set();
  for (const e of S.expenses) if (e.groupId === g.id && !e.deleted) { e.payers.forEach((x) => used.add(x.id)); e.shares.forEach((x) => used.add(x.id)); }
  for (const p of S.payments) if (p.groupId === g.id && !p.deleted) { used.add(p.from); used.add(p.to); }
  const others = S.people.filter((p) => !g.memberIds.includes(p.id));
  return `<div class="page sheet">${topBack('Group settings')}
    <div class="lbl">Name</div><input class="input" data-in="g-name" data-gid="${g.id}" value="${esc(g.name)}" maxlength="40">
    <div class="lbl">Type</div><select class="input" data-in="g-type" data-gid="${g.id}">${Object.keys(TYPES).map((t) => opt(t, `${TYPES[t]}  ${t}`, g.type)).join('')}</select>
    <div class="lbl">Dates (optional)</div>
    <div class="tools" style="margin-top:0"><label>From<input type="date" data-in="g-date" data-k="tripStart" data-gid="${g.id}" value="${esc(g.tripStart)}"></label>
      <label>To<input type="date" data-in="g-date" data-k="tripEnd" data-gid="${g.id}" value="${esc(g.tripEnd)}"></label></div>
    <div class="lbl">Members</div>
    ${g.memberIds.map((id) => `<div class="person">${av(id)}<div class="n">${esc(nm(id))}${id === S.me ? '' : `<small>${used.has(id) ? 'has expenses in this group' : 'no expenses yet'}</small>`}</div>
      ${id !== S.me && !used.has(id) ? `<button class="chip" data-act="g-remove" data-gid="${g.id}" data-id="${id}">Remove</button>` : ''}</div>`).join('')}
    ${others.length ? `<div class="boxrow"><span class="mut">Add a friend</span><select data-in="g-add" data-gid="${g.id}"><option value="">Choose…</option>${others.map((p) => opt(p.id, p.name, '')).join('')}</select></div>` : ''}
    <div class="inline"><input class="input" id="g-new" placeholder="New person's name" maxlength="30"><button class="chip pri" data-act="g-add-new" data-gid="${g.id}">Add</button></div>
    <button class="setrow" style="margin-top:14px" data-act="toggle-simplify" data-gid="${g.id}"><div><b>Simplify debts</b><small>Fewer payments between people</small></div><div class="switch ${g.simplify ? 'on' : ''}"></div></button>
    ${vShareBox(g)}
    <button class="btn danger" style="margin-top:22px" data-act="g-delete" data-gid="${g.id}">Delete group</button></div>`;
}

// ------------------------------------------------------ sharing (phase 7)
function vShareBox(g) {
  warm();
  if (!g.shared) {
    return `<div class="lbl">Share with friends</div>
      <div class="card"><p class="hint" style="text-align:left;margin:0 0 10px">Friends get a link, log in with their email and a password, pick their name, and then everyone adds expenses to this group from their own phone. The group is stored online (Google Firebase); other groups stay only on this phone.</p>
      ${sync.user
        ? `<button class="btn" data-act="share-group" data-gid="${g.id}" ${sync.busy ? 'disabled' : ''}>${sync.busy === 'share' ? 'Sharing…' : 'Share this group'}</button>`
        : `<button class="btn" data-act="need-login">Log in to share</button>`}</div>`;
  }
  const joined = g.memberIds.filter((id) => g.uids?.[id]).length;
  return `<div class="lbl">Shared group</div>
    <div class="card"><p class="hint" style="text-align:left;margin:0 0 10px">${joined} of ${g.memberIds.length} people have joined. ${g.memberIds.map((id) => `${esc(nm(id))} ${g.uids?.[id] ? '✓' : '…'}`).join(' · ')}</p>
    ${g.inviteCode ? `<button class="btn" data-act="send-invite" data-gid="${g.id}">Send invite link</button>` : ''}
    ${sync.user ? '' : `<button class="btn ghost" style="margin-top:8px" data-act="need-login">Log in to keep this group in sync</button>`}</div>`;
}

/** Log in / create account / forgot password. Used on its own page and inside the join screen. */
function authForm() {
  const a = ui.auth, m = a.mode;
  const title = m === 'signup' ? 'Create an account' : m === 'reset' ? 'Reset your password' : 'Log in';
  const field = (k, label, type, auto, ph) => `<div class="lbl">${label}</div><input class="input" id="auth-${k}" data-in="auth" data-k="${k}" type="${type}" value="${esc(a[k])}" autocomplete="${auto}" placeholder="${ph}" ${k === 'email' ? 'inputmode="email" autocapitalize="off"' : ''}>`;
  return `<h2 class="title" style="font-size:24px">${title}</h2>
    ${m === 'signup' ? '<p class="mut" style="margin:6px 0 0">Only needed to share groups. Use any email you can open, so you can reset the password later.</p>' : ''}
    ${m === 'reset' ? '<p class="mut" style="margin:6px 0 0">We will email you a link to choose a new password.</p>' : ''}
    ${field('email', 'Email', 'email', 'email', 'you@example.com')}
    ${m !== 'reset' ? field('password', 'Password', 'password', m === 'signup' ? 'new-password' : 'current-password', m === 'signup' ? 'At least 6 characters' : '') : ''}
    ${m === 'signup' ? field('password2', 'Type the password again', 'password', 'new-password', '') : ''}
    <div class="hint err" id="auth-err" style="margin-top:8px;text-align:left">${esc(a.err)}</div>
    ${a.info ? `<div class="hint pos" style="margin-top:8px;text-align:left">${esc(a.info)}</div>` : ''}
    <button class="btn" style="margin-top:12px" data-act="auth-submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'Please wait…' : m === 'signup' ? 'Create account' : m === 'reset' ? 'Send reset link' : 'Log in'}</button>
    <div class="center" style="margin-top:16px;display:flex;flex-direction:column;gap:12px">
      ${m !== 'login' ? '<button class="link" data-act="auth-mode" data-m="login">I already have an account: log in</button>' : '<button class="link" data-act="auth-mode" data-m="signup">New here? Create an account</button>'}
      ${m === 'login' ? '<button class="link" data-act="auth-mode" data-m="reset">Forgot password?</button>' : ''}
    </div>`;
}
function vLogin() {
  if (sync.user) { setTimeout(() => { history.replaceState(null, '', ui.afterLogin || '#/account'); render(); }, 0); return '<div class="page"></div>'; }
  warm();
  return `<div class="page sheet">${topBack('Account')}${authForm()}</div>`;
}

function vJoin(gid, code) {
  const head = `<div class="page"><div class="top center"><button class="icon-btn" data-act="go" data-to="#/" aria-label="Close">${I.close}</button><h1>Join a group</h1><span style="width:28px"></span></div>`;
  const g = group(gid);
  warm();
  if (sync.user && !g && !sync.busy && !sync.error && ui.joinTried !== code) {
    ui.joinTried = code;
    setTimeout(() => actions['join-retry']({ gid, code }), 0);
  }
  if (!sync.user) {
    if (!ui.joinFormSet) { ui.joinFormSet = true; ui.auth.mode = 'signup'; }
    return `${head}<p class="mut" style="margin:6px 0 4px">You're invited to a shared group. Create an account (or log in) so Split Pay knows it's you.</p>
      ${authForm()}</div>`;
  }
  if (!g) {
    return `${head}<div style="height:6vh"></div><h2 class="title">Joining…</h2>
      <p class="mut" style="margin:10px 0 22px">Logged in as ${esc(sync.user.email)}. Getting the group.</p>
      ${sync.error ? `<div class="hint err">${esc(syncErrorText())}</div><button class="btn" style="margin-top:12px" data-act="join-retry" data-gid="${gid}" data-code="${esc(code)}">Try again</button>` : ''}</div>`;
  }
  if (claimedHere(g)) { setTimeout(() => { history.replaceState(null, '', `#/g/${g.id}`); render(); }, 0); return head + '</div>'; }
  const open = g.memberIds.filter((id) => !g.uids?.[id]);
  return `${head}<h2 class="title">${esc(g.name)}</h2>
    <p class="mut" style="margin:6px 0 16px">Who are you in this group?</p>
    ${open.map((id) => `<button class="person" data-act="claim" data-gid="${g.id}" data-id="${id}">${av(id)}<div class="n">I am ${esc(person(id).name)}</div><span class="pos">›</span></button>`).join('')}
    <button class="btn ghost" style="margin-top:16px" data-act="add-me" data-gid="${g.id}">I'm not on the list, add me as ${esc(person(S.me).name)}</button></div>`;
}
function syncErrorText(code) {
  const e = code || sync.error;
  if (e === 'not-found') return 'This invite link does not work any more. Ask for a new one.';
  if (e === 'permission-denied') return 'This invite link was not accepted. Ask your friend to send it again.';
  if (e === 'need-login') return 'Log in first.';
  if (e === 'auth/invalid-credential' || e === 'auth/wrong-password' || e === 'auth/user-not-found') return 'Wrong email or password.';
  if (e === 'auth/invalid-email' || e === 'auth/missing-email') return 'That email address does not look right.';
  if (e === 'auth/email-already-in-use') return 'There is already an account with this email. Log in instead.';
  if (e === 'auth/weak-password' || e === 'auth/missing-password') return 'Use a password of at least 6 characters.';
  if (e === 'auth/too-many-requests') return 'Too many tries. Wait a few minutes, or reset your password.';
  if (e === 'offline' || e === 'unavailable' || e === 'auth/network-request-failed') return 'No internet connection.';
  return `Something went wrong (${e}).`;
}

function vWhiteboard(g) {
  return `<div class="page sheet">${topBack('Whiteboard')}
    <div class="mut center" style="font-size:13px">${esc(g.name)}</div>
    <textarea class="input wb" data-in="wb" data-gid="${g.id}" placeholder="Notes for this group: addresses, booking codes, Wi-Fi passwords, who brings what…">${esc(g.whiteboard)}</textarea>
    <div class="hint">Saved automatically.</div></div>`;
}

function vNewGroup() {
  const d = ui.draft;
  return `<div class="page sheet">${topBack('Create a group', undefined, I.close)}
    <div class="lbl">Group name</div><input class="input" data-in="d" data-k="name" value="${esc(d.name)}" placeholder="e.g. Bali Trip" maxlength="40">
    <div class="lbl">Type</div><div class="seg">${Object.keys(TYPES).map((t) => `<button class="${d.gtype === t ? 'on' : ''}" data-act="ng-type" data-t="${t}">${TYPES[t]} ${t}</button>`).join('')}</div>
    ${friends().length ? `<div class="lbl">Friends</div>${friends().map((p) => `<button class="person" data-act="ng-toggle" data-id="${p.id}">${av(p.id)}<div class="n">${esc(p.name)}</div><div class="check ${d.sel[p.id] ? 'on' : ''}">✓</div></button>`).join('')}` : ''}
    <div class="lbl">Add new people</div><input class="input" data-in="d" data-k="names" value="${esc(d.names)}" placeholder="Names, separated by commas">
    <div class="hint" style="margin-top:8px">You are added automatically.</div>
    <div class="bottom"><button class="btn" data-act="ng-save">Create group</button></div></div>`;
}

// --------------------------------------------------------------- totals
function monthKey(offset) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function vTotals(g) {
  const all = S.expenses.filter((e) => e.groupId === g.id && !e.deleted);
  if (!all.length) return `<div class="page sheet">${topBack('Totals')}<div class="empty"><b>Nothing to total yet</b>Add an expense first.</div></div>`;
  const curs = [...new Set(all.map((e) => e.currency))];
  const t = (ui.tot[g.id] ||= { period: g.tripStart ? 'trip' : 'all', cur: curs.includes(S.settings.currency) ? S.settings.currency : curs[0], sel: 5 });
  if (!curs.includes(t.cur)) t.cur = curs[0];
  const periods = [['month', 'This month'], ['last', 'Last month'], ['all', 'All time'], ...(g.tripStart ? [['trip', 'Trip dates']] : [])];
  const inPeriod = (date) => t.period === 'month' ? date.startsWith(monthKey(0)) : t.period === 'last' ? date.startsWith(monthKey(-1))
    : t.period === 'trip' ? date >= g.tripStart && (!g.tripEnd || date <= g.tripEnd) : true;
  const list = all.filter((e) => e.currency === t.cur && inPeriod(e.date));
  const spent = list.reduce((a, e) => a + e.amount, 0);
  const share = list.reduce((a, e) => a + (e.shares.find((x) => x.id === S.me)?.amount || 0), 0);
  const paid = list.reduce((a, e) => a + (e.payers.find((x) => x.id === S.me)?.amount || 0), 0);
  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const catMax = cats[0]?.[1] || 1;
  const months = [-5, -4, -3, -2, -1, 0].map((o) => {
    const k = monthKey(o);
    return { k, label: new Date(k + '-01T00:00').toLocaleString('en-US', { month: 'short' }), v: all.filter((e) => e.currency === t.cur && e.date.startsWith(k)).reduce((a, e) => a + e.amount, 0) };
  });
  const mMax = Math.max(1, ...months.map((m) => m.v));
  const sel = months[t.sel] || months[5];
  return `<div class="page sheet">${topBack('Totals')}
    <div class="mut center" style="font-size:13px">${esc(groupTitle(g))}</div>
    <div class="seg" style="margin-top:12px">${periods.map(([k, l]) => `<button class="${t.period === k ? 'on' : ''}" data-act="tot-period" data-gid="${g.id}" data-p="${k}">${l}</button>`).join('')}</div>
    ${curs.length > 1 ? `<div class="chips">${curs.map((c) => `<button class="chip ${c === t.cur ? 'pri' : ''}" data-act="tot-cur" data-gid="${g.id}" data-c="${c}">${c}</button>`).join('')}</div>` : ''}
    <div class="stats">
      <div class="stat"><small>Group spending</small><b>${fmt(spent, t.cur)}</b></div>
      <div class="stat"><small>Your share</small><b>${fmt(share, t.cur)}</b></div>
      <div class="stat"><small>You paid</small><b>${fmt(paid, t.cur)}</b></div>
      <div class="stat"><small>Expenses</small><b>${list.length}</b></div>
    </div>
    <div class="lbl">By category</div>
    ${cats.length ? cats.map(([c, v]) => `<div class="hbar"><div class="hbar-top"><span>${c} ${esc(catName(c))}</span><b>${fmt(v, t.cur)}</b></div><div class="track"><span style="width:${Math.max(2, (v / catMax) * 100)}%"></span></div></div>`).join('')
      : '<div class="hint" style="text-align:left">No expenses in this period.</div>'}
    <div class="lbl">Group spending by month</div>
    <div class="readout"><span class="mut">${new Date(sel.k + '-01T00:00').toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span><b>${fmt(sel.v, t.cur)}</b></div>
    <div class="bars" role="img" aria-label="Group spending for the last six months">${months.map((m, i) => `<button class="bar ${m === sel ? 'on' : ''}" data-act="tot-month" data-gid="${g.id}" data-i="${i}" aria-label="${m.label}: ${fmt(m.v, t.cur)}"><div class="col"><span style="height:${m.v ? Math.max(3, (m.v / mMax) * 100) : 0}%"></span></div><small>${m.label}</small></button>`).join('')}</div>
    <div class="hint" style="margin-top:6px">Tap a month to see its total. All periods count only ${t.cur} expenses.</div></div>`;
}

// ------------------------------------------------------- expense form
function draftMembers(d) {
  const g = group(d.groupId);
  if (!g.nongroup) return g.memberIds;
  return [S.me, ...friends().filter((p) => d.with[p.id]).map((p) => p.id)];
}
function newExpenseDraft(gid) {
  const g = group(gid) || realGroups()[0] || nonGroup();
  return { type: 'expense', id: null, groupId: g.id, desc: '', category: S.settings.categories[0]?.e || '🧾', amountStr: '', currency: S.settings.currency, date: today(), note: '',
    method: 'equal', inc: {}, vals: {}, payerMode: 'single', payerId: S.me, payAmts: {}, with: {}, repeat: 'none', photoId: null, photoData: null, photoDirty: false };
}
function draftCalc(d) {
  const cur = d.currency, amount = parseAmt(d.amountStr, cur), m = draftMembers(d);
  const f = (id) => parseFloat(d.vals[id]) || 0;
  let parts;
  if (d.method === 'equal') parts = m.filter((id) => d.inc[id] !== false).map((id) => ({ id, value: 0 }));
  else if (d.method === 'exact' || d.method === 'adjust') parts = m.map((id) => ({ id, value: parseAmt(d.vals[id], cur) }));
  else parts = m.map((id) => ({ id, value: Math.max(0, Math.round(f(id) * 100)) }));
  let err = '', shares = [];
  if (group(d.groupId).nongroup && m.length < 2) err = 'Pick at least one friend.';
  else {
    const r = split({ amount, method: d.method, parts });
    if (r.ok) shares = r.data;
    else {
      const [k, v] = r.error.split(':');
      if (k === 'diff') err = +v > 0 ? `${fmt(+v, cur)} left to assign` : `${fmt(+v, cur)} over the total`;
      else if (k === 'pct') err = +v > 0 ? `${+v / 100}% left to assign` : `${-v / 100}% over 100%`;
      else err = r.error;
    }
  }
  let payers, payErr = '';
  if (d.payerMode === 'single') payers = [{ id: m.includes(d.payerId) ? d.payerId : S.me, amount }];
  else {
    payers = m.map((id) => ({ id, amount: parseAmt(d.payAmts[id], cur) })).filter((x) => x.amount > 0);
    const s = payers.reduce((a, x) => a + x.amount, 0);
    if (s !== amount) payErr = s < amount ? `Payers: ${fmt(amount - s, cur)} left to assign` : `Payers: ${fmt(s - amount, cur)} over the total`;
  }
  return { amount, shares, err, payers, payErr, cur };
}
function expenseHint(d) {
  const c = draftCalc(d);
  if (c.err && group(d.groupId).nongroup && draftMembers(d).length < 2) return { text: c.err, err: true };
  if (!c.amount) return { text: 'Enter an amount', err: false };
  if (c.payErr) return { text: c.payErr, err: true };
  if (c.err) return { text: c.err, err: true };
  if (d.method === 'equal') return { text: `${fmt(c.shares[0]?.amount || 0, c.cur)} per person · ${c.shares.length} ${c.shares.length === 1 ? 'person' : 'people'}`, err: false };
  return { text: `Split between ${c.shares.length} ${c.shares.length === 1 ? 'person' : 'people'}`, err: false };
}
function vExpense() {
  const d = ui.draft, g = group(d.groupId), h = expenseHint(d);
  const payer = d.payerMode === 'single' ? (d.payerId === S.me ? 'you' : person(d.payerId).name) : 'multiple people';
  const label = (x) => (x.nongroup ? '👤 Friends, no group' : `${TYPES[x.type]} All of ${x.name}`);
  const choices = [...realGroups(), ...(friends().length ? [nonGroup()] : [])];
  const cats = S.settings.categories.some((c) => c.e === d.category) ? S.settings.categories : [{ e: d.category, n: catName(d.category) }, ...S.settings.categories];
  const withRow = g.nongroup ? `<div class="chips wrap">${friends().map((p) => `<button class="chip ${d.with[p.id] ? 'pri' : ''}" data-act="x-with" data-id="${p.id}">${esc(p.name)}</button>`).join('') || '<span class="mut">Add friends in the Friends tab first.</span>'}</div>` : '';
  return `<div class="page sheet"><div class="top center"><button class="icon-btn" data-act="back" aria-label="Close">${I.close}</button><h1>${d.id ? 'Edit expense' : 'Add expense'}</h1><button class="act" data-act="save-expense">Save</button></div>
    <div class="boxrow" style="margin-top:4px"><span class="mut">With you and</span>${d.id || choices.length < 2 ? `<b>${esc(label(g))}</b>`
      : `<select data-in="x-group">${choices.map((x) => opt(x.id, label(x), d.groupId)).join('')}</select>`}</div>
    ${withRow}
    <div class="field" style="margin-top:10px"><div class="tile pick"><span>${d.category}</span><select data-in="d" data-k="category" data-re="1" aria-label="Category">${cats.map((c) => opt(c.e, `${c.e} ${c.n}`, d.category)).join('')}</select></div>
      <input data-in="d" data-k="desc" value="${esc(d.desc)}" placeholder="What was it for?" maxlength="60" autocomplete="off"></div>
    <div class="field"><div class="tile cur"><select data-in="x-cur" aria-label="Currency">${curOpts(d.currency)}</select></div>
      <input class="big" data-in="x-amount" value="${esc(d.amountStr)}" placeholder="0" inputmode="decimal" autocomplete="off"></div>
    <div class="sentence">Paid by <button class="chip pri" data-act="go" data-to="#/expense/split">${esc(payer)}</button> and split <button class="chip pri" data-act="go" data-to="#/expense/split">${METHODS.find((x) => x[0] === d.method)[2]}</button></div>
    <div class="hint ${h.err ? 'err' : ''}" id="x-hint">${esc(h.text)}</div>
    <div class="tools"><label>📅<input type="date" data-in="d" data-k="date" value="${esc(d.date)}"></label><label>📝<input data-in="d" data-k="note" value="${esc(d.note)}" placeholder="Add note" maxlength="120"></label></div>
    <div class="tools" style="margin-top:8px"><label>↻<select data-in="d" data-k="repeat">${Object.entries(REPEATS).map(([k, v]) => opt(k, v, d.repeat)).join('')}</select></label>
      <label class="photo-btn">📷 ${d.photoData ? 'Change photo' : 'Add photo'}<input type="file" id="x-photo-file" accept="image/*" hidden></label></div>
    ${d.photoData ? `<div class="thumb-row"><img class="thumb" src="${d.photoData}" alt="Receipt photo" data-act="view-photo"><button class="chip" data-act="x-photo-remove">Remove photo</button></div>` : ''}
    ${d.id ? `<button class="btn danger" style="margin-top:26px" data-act="delete-expense">Delete expense</button>` : ''}
    <div class="bottom"><button class="btn" data-act="save-expense">Save expense</button></div></div>`;
}
function vSplit() {
  const d = ui.draft, m = draftMembers(d);
  const ph = { exact: '0', percent: '%', shares: 'shares', adjust: '+ extra' }[d.method];
  const people = m.map((id) => d.method === 'equal'
    ? `<button class="person" data-act="x-inc" data-id="${id}">${av(id)}<div class="n">${esc(nm(id))}</div><div class="amt" data-share="${id}"></div><div class="check ${d.inc[id] !== false ? 'on' : ''}">✓</div></button>`
    : `<label class="person">${av(id)}<div class="n">${esc(nm(id))}<small data-share="${id}"></small></div><input class="num" data-in="x-val" data-id="${id}" value="${esc(d.vals[id] ?? '')}" placeholder="${ph}" inputmode="decimal" autocomplete="off"></label>`).join('');
  const multi = d.payerMode === 'multi' ? m.map((id) => `<label class="person">${av(id)}<div class="n">${esc(nm(id))}</div><input class="num" data-in="x-pay" data-id="${id}" value="${esc(d.payAmts[id] ?? '')}" placeholder="0" inputmode="decimal" autocomplete="off"></label>`).join('') : '';
  const help = { equal: 'Tick who shares this cost.', exact: 'Type how much each person owes.', percent: 'Type each person’s percentage. Must total 100.', shares: 'Type shares, e.g. 2 nights = 2 shares.', adjust: 'Type who owes extra. The rest is split equally.' }[d.method];
  const presets = d.method === 'equal' ? `<div class="chips wrap">${S.settings.presets.map((p) => `<button class="chip" data-act="x-preset" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
      <button class="chip" data-act="x-preset-save">+ Save as preset</button></div>` : '';
  return `<div class="page sheet"><div class="top center"><button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button><h1>Adjust split</h1><button class="act" data-act="back">Done</button></div>
    <div class="boxrow"><span class="mut">Paid by</span><select data-in="x-payer">${m.map((id) => opt(id, nm(id), d.payerMode === 'single' ? d.payerId : '')).join('')}${opt('*', 'Multiple people', d.payerMode === 'multi' ? '*' : '')}</select></div>
    ${multi}<div class="hint err" id="pay-hint" style="margin-top:6px"></div>
    <div class="lbl">Split method</div><div class="seg">${METHODS.map(([k, label]) => `<button class="${d.method === k ? 'on' : ''}" data-act="x-method" data-m="${k}">${label}</button>`).join('')}</div>
    <div class="hint" style="margin:10px 0 2px">${help}</div>
    ${presets}
    ${people}<div class="hint" id="split-hint" style="margin-top:14px"></div></div>`;
}
function refreshSplit() {
  const d = ui.draft;
  if (!d || d.type !== 'expense' || !location.hash.startsWith('#/expense') || !group(d.groupId)) return;
  const c = draftCalc(d);
  document.querySelectorAll('[data-share]').forEach((el) => {
    const s = c.shares.find((x) => x.id === el.dataset.share);
    el.textContent = s && !c.err ? fmt(s.amount, c.cur) : '';
  });
  const sh = document.getElementById('split-hint');
  if (sh) { sh.textContent = !c.amount ? 'Enter the amount on the previous screen first.' : c.err || `Total ${fmt(c.amount, c.cur)} · nothing left to assign`; sh.classList.toggle('err', !!c.err && !!c.amount); }
  const ph = document.getElementById('pay-hint'); if (ph) ph.textContent = c.amount ? c.payErr : '';
  const xh = document.getElementById('x-hint');
  if (xh) { const h = expenseHint(d); xh.textContent = h.text; xh.classList.toggle('err', h.err); }
}

// ------------------------------------------------------- payment form
function vPayment() {
  const d = ui.draft, g = group(d.groupId);
  const sel = (k, v) => `<select data-in="d" data-k="${k}" data-re="1">${g.memberIds.map((id) => opt(id, nm(id), v)).join('')}</select>`;
  return `<div class="page sheet"><div class="top center"><button class="icon-btn" data-act="back" aria-label="Close">${I.close}</button><h1>Record a payment</h1><button class="act" data-act="save-payment">Save</button></div>
    <div class="flow">${av(d.from, 'lg')}<div class="arrow">→</div>${av(d.to, 'lg')}</div>
    <div class="boxrow"><span class="mut">From</span>${sel('from', d.from)}</div>
    <div class="boxrow"><span class="mut">To</span>${sel('to', d.to)}</div>
    <div class="field" style="margin-top:10px"><div class="tile cur"><select data-in="d" data-k="currency" aria-label="Currency">${curOpts(d.currency)}</select></div>
      <input class="big" data-in="d" data-k="amountStr" value="${esc(d.amountStr)}" placeholder="0" inputmode="decimal" autocomplete="off"></div>
    <div class="tools"><label>📅<input type="date" data-in="d" data-k="date" value="${esc(d.date)}"></label><label>📝<input data-in="d" data-k="note" value="${esc(d.note)}" placeholder="Add note" maxlength="120"></label></div>
    <div class="hint" style="margin-top:18px">This only records the payment.<br>No money moves inside the app.</div>
    ${d.id ? `<button class="btn danger" style="margin-top:22px" data-act="delete-payment">Delete payment</button>` : ''}
    <div class="bottom"><button class="btn" data-act="save-payment">Save payment</button></div></div>`;
}

// ------------------------------------------------------------- search
function searchResults() {
  const q = ui.q.trim().toLowerCase();
  if (!q) return '<div class="hint" style="margin-top:20px">Type a word, a friend’s name, a category or an amount.</div>';
  const hit = (s) => String(s || '').toLowerCase().includes(q);
  const items = itemsOf((x) => {
    if (!group(x.groupId)) return false;
    if (x.desc !== undefined) {
      return hit(x.desc) || hit(x.note) || hit(catName(x.category)) || hit(groupTitle(group(x.groupId))) || hit(plain(x.amount, x.currency))
        || [...x.payers, ...x.shares].some((a) => hit(person(a.id).name));
    }
    return hit('payment') || hit(x.note) || hit(person(x.from).name) || hit(person(x.to).name) || hit(plain(x.amount, x.currency));
  }).slice(0, 100);
  return items.length ? `<div class="hint" style="text-align:left;margin:12px 0 4px">${items.length === 100 ? 'First 100 results' : `${items.length} result${items.length === 1 ? '' : 's'}`}</div>${items.map((it) => rowHtml(it, true)).join('')}`
    : '<div class="empty"><b>No matches</b>Try another word.</div>';
}
function vSearch() {
  return `<div class="page sheet"><div class="top"><button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button>
    <input class="input" id="search-box" data-in="search" value="${esc(ui.q)}" placeholder="Search expenses" autocomplete="off"></div>
    <div id="results">${searchResults()}</div></div>`;
}

// ------------------------------------------------ friends / activity / account
function vFriends() {
  const per = {};
  for (const g of liveGroups()) for (const l of myLines(groupBal(g))) {
    per[l.other] = per[l.other] || {};
    per[l.other][l.cur] = (per[l.other][l.cur] || 0) + l.amount;
  }
  const rows = friends().map((p) => {
    const n = per[p.id] || {};
    const keys = Object.keys(n).filter((c) => n[c] !== 0);
    const end = keys.length ? `<div class="end">${keys.map((c) => `<span class="${n[c] > 0 ? 'pos' : 'neg'}">${n[c] > 0 ? 'owes you' : 'you owe'}<b>${fmt(n[c], c)}</b></span>`).join('')}</div>` : `<div class="end mut">settled up</div>`;
    return `<div class="row">${av(p.id)}<div class="mid"><b>${esc(p.name)}</b></div>${end}</div>`;
  }).join('');
  return `<div class="page"><div class="top"><h1>Friends</h1></div>
    ${rows || `<div class="empty"><b>No friends yet</b>Add people here, or while creating a group.</div>`}
    <div class="inline" style="margin-top:18px"><input class="input" id="f-new" placeholder="Friend's name" maxlength="30"><button class="chip pri" data-act="f-add">Add</button></div>
    </div>${friends().length ? fab(nonGroup().id) : ''}${tabs('friends')}`;
}
function vActivity() {
  const rows = S.activity.map((a) => `<div class="act-item">${esc(a.text)}<br><small>${new Date(a.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div>`).join('');
  return `<div class="page"><div class="top"><h1>Recent activity</h1></div>${rows || `<div class="empty"><b>Nothing yet</b>Changes you make will show up here.</div>`}</div>${tabs('activity')}`;
}
function vAccount() {
  const light = S.settings.theme === 'light';
  const rateCount = Object.keys(CUR).filter((c) => c !== BASE && parseFloat(S.settings.rates[c]) > 0).length;
  return `<div class="page"><div class="top"><h1>Account</h1></div>
    <div class="card"><div class="head">${av(S.me, 'lg')}<div style="flex:1"><div class="mut" style="font-size:12px">Your name</div><input class="input" data-in="me-name" value="${esc(person(S.me).name)}" maxlength="30"></div></div></div>
    <div class="lbl">Preferences</div>
    <button class="setrow" data-act="toggle-theme"><div><b>Light theme</b><small>Switch between dark and light</small></div><div class="switch ${light ? 'on' : ''}"></div></button>
    <div class="setrow"><div><b>Default currency</b><small>Used for new expenses and conversions</small></div><select data-in="set-cur">${curOpts(S.settings.currency)}</select></div>
    <button class="setrow" data-act="go" data-to="#/account/rates"><div><b>Exchange rates</b><small>${rateCount ? `${rateCount} of ${Object.keys(CUR).length - 1} set` : 'Not set yet'}</small></div><span class="mut">›</span></button>
    <button class="setrow" data-act="go" data-to="#/account/categories"><div><b>Categories</b><small>${S.settings.categories.length} categories</small></div><span class="mut">›</span></button>
    <button class="setrow" data-act="go" data-to="#/account/presets"><div><b>People presets</b><small>${S.settings.presets.length ? `${S.settings.presets.length} saved` : 'Save one from “Adjust split”'}</small></div><span class="mut">›</span></button>
    <div class="lbl">Sync with friends</div>
    ${(warm(), sync.user)
      ? `<div class="setrow"><div><b>Logged in</b><small>${esc(sync.user.email)} · ${realGroups().filter((g) => g.shared).length} shared group(s)</small></div><button class="chip" data-act="sign-out">Log out</button></div>`
      : `<button class="setrow" data-act="need-login"><div><b>Log in or create an account</b><small>${S.sync?.uid ? 'Logged out. Log in again to keep shared groups in sync' : 'Only needed for groups you share. Share one from its settings'}</small></div><span class="pos">Log in</span></button>`}
    <div class="lbl">Security</div>
    <button class="setrow" data-act="go" data-to="#/account/lock"><div><b>App lock</b><small>${S.settings.lock ? `On${S.settings.lock.bio ? ', with fingerprint' : ''}` : 'Off'}</small></div><span class="mut">›</span></button>
    <div class="lbl">Your data</div>
    ${sync.user
      ? `<button class="setrow" data-act="backup-online"><div><b>Back up online now</b><small>${S.settings.lastOnlineBackup ? `Last: ${new Date(S.settings.lastOnlineBackup).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · also automatic once a day` : 'To Firebase, under your account · also automatic once a day'}</small></div><span class="pos">${ui.bk.busy ? '…' : 'Back up'}</span></button>
        <button class="setrow" data-act="open-backups"><div><b>Restore from online backup</b><small>Pick one of your last 5 online backups</small></div><span class="mut">›</span></button>`
      : `<button class="setrow" data-act="need-login"><div><b>Online backup</b><small>Log in to back up to Firebase automatically every day</small></div><span class="pos">Log in</span></button>`}
    <button class="setrow" data-act="backup"><div><b>Back up to a file</b><small>Save one file, e.g. to Google Drive</small></div><span class="pos">Save</span></button>
    <button class="setrow" data-act="restore"><div><b>Restore from a file</b><small>Replace everything here with a backup file</small></div><span class="pos">Open</span></button>
    <input type="file" id="restore-file" accept="application/json,.json" hidden>
    <p class="hint" style="margin-top:22px">Split Pay ${APP_VERSION} · ${S.expenses.filter((e) => !e.deleted).length} expenses · ${realGroups().some((g) => g.shared) ? 'shared groups sync online, the rest stays on this device' : 'data stays on this device'}</p>
    </div>${tabs('account')}`;
}
function vRates() {
  return `<div class="page sheet">${topBack('Exchange rates')}
    <p class="hint" style="text-align:left;margin:6px 0 10px">Type today’s rate for each currency you use. Split Pay does not fetch rates from the internet, so update them when they change.</p>
    ${Object.keys(CUR).filter((c) => c !== BASE).map((c) => `<label class="setrow"><div><b>1 ${c}</b><small>= how many ${BASE}?</small></div><input class="num" style="width:140px" data-in="rate" data-c="${c}" value="${esc(S.settings.rates[c] ?? '')}" placeholder="${BASE}" inputmode="decimal" autocomplete="off"></label>`).join('')}
    <div class="hint" style="margin-top:12px">Used by “Show all in ${S.settings.currency}” on the Balances screen.</div></div>`;
}
function vCategories() {
  const cats = S.settings.categories;
  return `<div class="page sheet">${topBack('Categories')}
    ${cats.map((c, i) => `<div class="person"><div class="tile">${c.e}</div><div class="n">${esc(c.n)}</div>${cats.length > 1 ? `<button class="chip" data-act="cat-del" data-i="${i}">Remove</button>` : ''}</div>`).join('')}
    <div class="lbl">Add a category</div>
    <div class="inline"><input class="input emoji" id="cat-e" placeholder="🎤" maxlength="4" autocomplete="off"><input class="input" id="cat-n" placeholder="Name, e.g. Karaoke" maxlength="20"><button class="chip pri" data-act="cat-add">Add</button></div>
    <div class="hint" style="margin-top:10px">Removing a category does not change old expenses.</div></div>`;
}
function vPresets() {
  const ps = S.settings.presets;
  return `<div class="page sheet">${topBack('People presets')}
    ${ps.map((p) => `<div class="person"><div class="n">${esc(p.name)}<small>${p.ids.map((id) => esc(nm(id))).join(', ')}</small></div><button class="chip" data-act="preset-del" data-id="${p.id}">Remove</button></div>`).join('')
      || '<div class="empty"><b>No presets yet</b>In “Adjust split”, tick the usual people and tap “Save as preset”.</div>'}</div>`;
}
function vLockSetup() {
  const L = S.settings.lock;
  const bioOk = !!window.PublicKeyCredential;
  if (!L) {
    return `<div class="page sheet">${topBack('App lock')}
      <p class="hint" style="text-align:left;margin:6px 0 14px">Ask for a PIN when Split Pay opens, and after it has been in the background for one minute.</p>
      <div class="lbl">New PIN (4 to 8 digits)</div><input class="input pin" id="pin1" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      <div class="lbl">Type it again</div><input class="input pin" id="pin2" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
      <div class="hint err" id="pin-err" style="margin-top:8px"></div>
      <div class="bottom"><button class="btn" data-act="lock-on">Turn on app lock</button></div></div>`;
  }
  return `<div class="page sheet">${topBack('App lock')}
    <div class="setrow"><div><b>App lock is on</b><small>Locks on open and after one minute in the background</small></div><span class="pos">On</span></div>
    ${bioOk ? `<button class="setrow" data-act="toggle-bio"><div><b>Unlock with fingerprint</b><small>Uses the phone’s own fingerprint or face unlock</small></div><div class="switch ${L.bio ? 'on' : ''}"></div></button>` : ''}
    <button class="btn danger" style="margin-top:22px" data-act="lock-off">Turn off app lock</button>
    <p class="hint" style="margin-top:14px">If you forget the PIN, the only way in is to erase the data on this phone and restore a backup.</p></div>`;
}

// ---------------------------------------------------------------- router
function render() {
  document.documentElement.dataset.theme = S?.settings?.theme || 'dark';
  document.querySelector('meta[name=theme-color]').content = S?.settings?.theme === 'light' ? '#F6F7F2' : '#0E0F11';
  // Log-in first, for everyone.
  if (!sync.ready) {
    if (!ui.authFailed) { $app.innerHTML = '<div class="boot">Split Pay</div>'; return; }
    if (!S?.sync?.uid) { $app.innerHTML = vNoConnection(); return; }
    // Logged in before, but the log-in check cannot run (offline): carry on with this phone's data.
  } else if (!sync.user) { $app.innerHTML = vGate(); return; }
  else if (sync.otherAccount) { $app.innerHTML = vOtherAccount(); return; }
  if (!S) { $app.innerHTML = vOnboard(); return; }
  if (ui.locked) { $app.innerHTML = vLock(); document.getElementById('lock-pin')?.focus(); return; }
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const d = ui.draft;
  let html;
  if (parts[0] === 'expense' && d?.type === 'expense' && group(d.groupId)) html = parts[1] === 'split' ? vSplit() : vExpense();
  else if (parts[0] === 'payment' && d?.type === 'payment' && group(d.groupId)) html = vPayment();
  else if (parts[0] === 'new-group' && d?.type === 'group') html = vNewGroup();
  else if (parts[0] === 'g' && group(parts[1])) {
    const g = group(parts[1]);
    html = parts[2] === 'bal' ? vBalances(g) : parts[2] === 'totals' ? vTotals(g)
      : parts[2] === 'set' && !g.nongroup ? vGroupSettings(g) : parts[2] === 'wb' && !g.nongroup ? vWhiteboard(g) : vGroup(g);
  } else if (parts[0] === 'join' && parts[1] && parts[2]) html = vJoin(parts[1], parts[2]);
  else if (parts[0] === 'login') html = vLogin();
  else if (parts[0] === 'search') html = vSearch();
  else if (parts[0] === 'friends') html = vFriends();
  else if (parts[0] === 'activity') html = vActivity();
  else if (parts[0] === 'account') {
    html = parts[1] === 'backups' ? vBackups() : parts[1] === 'rates' ? vRates() : parts[1] === 'categories' ? vCategories() : parts[1] === 'presets' ? vPresets() : parts[1] === 'lock' ? vLockSetup() : vAccount();
  } else {
    if (parts[0]) history.replaceState(null, '', '#/');
    html = vGroups();
  }
  if (ui.viewer) html += `<div class="viewer" data-act="close-viewer"><img src="${ui.viewer}" alt="Receipt photo"><span>Tap to close</span></div>`;
  $app.innerHTML = html;
  refreshSplit();
  if (parts[0] === 'search') { const b = document.getElementById('search-box'); b?.focus(); b?.setSelectionRange(b.value.length, b.value.length); }
}
window.addEventListener('hashchange', () => { ui.viewer = null; render(); window.scrollTo(0, 0); });

// ------------------------------------------------------ sharing / export
function summaryLines(g) {
  return groupBal(g).flatMap((c) => c.debts.map((d) => ({ d, cur: c.currency })));
}
function summaryText(g) {
  const lines = summaryLines(g).map(({ d, cur }) => `• ${debtPlain(d.from, d.to, d.amount, cur)}`);
  return `*${groupTitle(g)}* — who owes whom\n${lines.length ? lines.join('\n') : 'Everyone is settled up 🎉'}\n\n_Sent from Split Pay_`;
}
async function shareText(text) {
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it into WhatsApp.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Could not share on this device.');
  }
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function groupCsv(g) {
  const items = itemsOf((x) => x.groupId === g.id).reverse();
  const ids = g.nongroup
    ? [S.me, ...friends().map((p) => p.id).filter((id) => items.some((it) => (it.e ? [...it.e.payers, ...it.e.shares].some((a) => a.id === id) : it.p.from === id || it.p.to === id)))]
    : g.memberIds;
  const head = ['Date', 'Description', 'Category', 'Cost', 'Currency', ...ids.map((id) => person(id).name), 'Paid by', 'Note'];
  const rows = items.map((it) => {
    if (it.kind === 'p') {
      const p = it.p;
      return [p.date, `${person(p.from).name} paid ${person(p.to).name}`, 'Payment', plain(p.amount, p.currency), p.currency,
        ...ids.map((id) => (id === p.from ? plain(p.amount, p.currency) : id === p.to ? plain(-p.amount, p.currency) : plain(0, p.currency))), person(p.from).name, p.note];
    }
    const e = it.e;
    const net = (id) => (e.payers.find((x) => x.id === id)?.amount || 0) - (e.shares.find((x) => x.id === id)?.amount || 0);
    return [e.date, e.desc, catName(e.category), plain(e.amount, e.currency), e.currency, ...ids.map((id) => plain(net(id), e.currency)),
      e.payers.map((x) => person(x.id).name).join(' + '), e.note];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
const fileSafe = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'group';

// ---------------------------------------------------------------- backup
/** Everything on this phone (all groups, friends, settings and photos) as one text. */
async function backupText() {
  return JSON.stringify({ app: 'split-pay', version: 2, exportedAt: nowIso(), state: S, photos: await photoAll() });
}
const isBackup = (obj) => obj?.app === 'split-pay' && !!obj.state?.people && !!obj.state?.me;
async function applyBackup(obj) {
  if (!isBackup(obj)) throw Object.assign(new Error('not a backup'), { code: 'not-a-backup' });
  S = migrate(obj.state);
  if (S.settings.lock) S.settings.lock.bio = null; // fingerprint keys belong to one phone
  if (sync.user) S.sync.uid = sync.user.uid; // the restored data now belongs to whoever is logged in
  await photoReplaceAll(obj.photos || {});
  await saveState();
  if (!location.hash.startsWith('#/join/')) history.replaceState(null, '', '#/');
  refresh();
  render();
}
async function doOnlineBackup() {
  const text = await backupText();
  await backupOnline(text, { expenses: S.expenses.filter((e) => !e.deleted).length, groups: realGroups().length, app: APP_VERSION });
  S.settings.lastOnlineBackup = nowIso();
  await saveQuiet();
}
/** Once a day, when logged in: back up online by itself. */
async function autoBackup() {
  if (!S || !sync.user) return;
  if (!S.expenses.length && !realGroups().length) return; // an empty phone must never push out good backups
  const last = S.settings.lastOnlineBackup;
  if (last && Date.now() - new Date(last).getTime() < 24 * 3600 * 1000) return;
  try { await doOnlineBackup(); render(); } catch { /* try again next time */ }
}
function vBackups() {
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const list = ui.bk.list;
  const rows = !list ? `<div class="hint">${ui.bk.err ? esc(ui.bk.err) : 'Loading…'}</div>`
    : !list.length ? '<div class="empty"><b>No online backups yet</b>Tap “Back up online now” in Account.</div>'
      : list.map((b) => `<div class="setrow"><div><b>${when(b.createdAt)}</b><small>${b.expenses ?? '?'} expenses · ${b.groups ?? '?'} groups · ${Math.max(1, Math.round(b.size / 1024))} KB</small></div><button class="chip pri" data-act="restore-online" data-id="${esc(b.id)}" ${ui.bk.busy ? 'disabled' : ''}>Restore</button></div>`).join('');
  return `<div class="page sheet">${topBack('Online backups')}
    <p class="hint" style="text-align:left;margin:6px 0 12px">Saved in Firebase under your account (${esc(sync.user?.email || '')}). Only you can open them. The newest 5 are kept.</p>
    ${rows}</div>`;
}

// ---------------------------------------------------------------- lock
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150_000, hash: 'SHA-256' }, key, 256));
}
const pinOk = async (pin) => (await hashPin(pin, S.settings.lock.salt)) === S.settings.lock.hash;
async function bioCheck() {
  const cred = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(S.settings.lock.bio) }], userVerification: 'required', timeout: 60_000 } });
  return !!cred;
}
document.addEventListener('visibilitychange', () => {
  if (!S?.settings?.lock) return;
  if (document.hidden) ui.hiddenAt = Date.now();
  else if (ui.hiddenAt && Date.now() - ui.hiddenAt > LOCK_AFTER_MS) { ui.locked = true; render(); }
});

// --------------------------------------------------------------- actions
async function afterUnlock() { ui.locked = false; render(); }
const actions = {
  go: (d) => go(d.to),
  back,
  onboard: async () => {
    const name = document.getElementById('ob-name').value.trim();
    if (!name) return toast('Please type your name.');
    const me = { id: uid(), name, color: '#C8F135', updatedAt: nowIso() };
    S = migrate({ version: 2, me: me.id, people: [me], groups: [], expenses: [], payments: [], activity: [], settings: { theme: 'dark', currency: 'IDR' } });
    S.sync.uid = sync.user?.uid || null;
    navigator.storage?.persist?.();
    await commit();
    refresh();
  },
  reload: () => location.reload(),
  'erase-local': async () => {
    if (!confirm("Erase all Split Pay data on this phone? The other account's shared groups and online backups are not touched.")) return;
    await kvPut('state', null);
    await photoReplaceAll({});
    S = null; ui.locked = false; ui.bk.list = null;
    refresh();
    history.replaceState(null, '', '#/');
    render();
  },
  unlock: async () => {
    const pin = document.getElementById('lock-pin').value;
    if (await pinOk(pin)) return afterUnlock();
    document.getElementById('lock-err').textContent = 'Wrong PIN. Try again.';
    document.getElementById('lock-pin').value = '';
  },
  'unlock-bio': async () => {
    try { if (await bioCheck()) return afterUnlock(); } catch { /* cancelled or not available */ }
    toast('Fingerprint did not work. Use your PIN.');
  },
  'forgot-pin': async () => {
    if (!confirm('Without the PIN, the only way in is to ERASE all Split Pay data on this phone. You can then restore a backup file. Erase now?')) return;
    if (!confirm('Last check: erase everything on this phone? This cannot be undone.')) return;
    await kvPut('state', null);
    await photoReplaceAll({});
    S = null; ui.locked = false; render();
  },
  'new-group': () => { ui.draft = { type: 'group', name: '', gtype: 'Trip', sel: {}, names: '' }; go('#/new-group'); },
  'ng-type': (d) => { ui.draft.gtype = d.t; render(); },
  'ng-toggle': (d) => { ui.draft.sel[d.id] = !ui.draft.sel[d.id]; render(); },
  'ng-save': async () => {
    const d = ui.draft, name = d.name.trim();
    if (!name) return toast('Give the group a name.');
    const ids = [S.me, ...Object.keys(d.sel).filter((id) => d.sel[id])];
    for (const n of d.names.split(',')) { const p = addPerson(n); if (p && !ids.includes(p.id)) ids.push(p.id); }
    if (ids.length < 2) return toast('Add at least one other person.');
    const g = { id: uid(), name, type: d.gtype, memberIds: ids, simplify: false, whiteboard: '', tripStart: '', tripEnd: '', createdAt: nowIso(), updatedAt: nowIso(), deleted: false };
    S.groups.push(g);
    log(`You created the group “${name}”.`);
    ui.draft = null;
    await saveState();
    history.replaceState(null, '', `#/g/${g.id}`);
    render();
  },
  'new-expense': (d) => {
    if (!realGroups().length && !friends().length) return toast('Create a group or add a friend first.');
    ui.draft = newExpenseDraft(d.gid);
    go('#/expense');
  },
  'edit-expense': async (d) => {
    const e = S.expenses.find((x) => x.id === d.id); if (!e) return;
    const input = structuredClone(e.input || {});
    const withIds = {};
    for (const a of [...e.payers, ...e.shares]) if (a.id !== S.me) withIds[a.id] = true;
    ui.draft = { type: 'expense', id: e.id, groupId: e.groupId, desc: e.desc, category: e.category, amountStr: toInput(e.amount, e.currency), currency: e.currency, date: e.date, note: e.note || '',
      method: 'equal', inc: {}, vals: {}, payerMode: 'single', payerId: S.me, payAmts: {}, ...input, with: input.with || withIds,
      repeat: e.repeat || 'none', photoId: e.photoId, photoData: null, photoDirty: false };
    go('#/expense');
    if (e.photoId) {
      let data = await photoGet(e.photoId);
      if (!data && group(e.groupId)?.shared) data = await fetchPhoto(e.groupId, e.photoId);
      if (ui.draft?.id === e.id && !ui.draft.photoDirty) { ui.draft.photoData = data || null; render(); }
    }
  },
  'x-method': (d) => { const x = ui.draft; x.method = d.m; x.vals = {}; if (d.m === 'shares') draftMembers(x).forEach((id) => { x.vals[id] = '1'; }); render(); },
  'x-inc': (d) => { const x = ui.draft; x.inc[d.id] = x.inc[d.id] === false; render(); },
  'x-with': (d) => {
    const x = ui.draft; x.with[d.id] = !x.with[d.id];
    if (!x.with[x.payerId] && x.payerId !== S.me) x.payerId = S.me;
    render();
  },
  'x-preset': (d) => {
    const p = S.settings.presets.find((x) => x.id === d.id), x = ui.draft;
    if (group(x.groupId).nongroup) { x.with = {}; p.ids.forEach((id) => { if (id !== S.me) x.with[id] = true; }); x.inc = {}; }
    else {
      const m = draftMembers(x), hits = m.filter((id) => p.ids.includes(id));
      if (!hits.length) return toast('Nobody from this preset is in the group.');
      x.inc = {}; m.forEach((id) => { if (!p.ids.includes(id)) x.inc[id] = false; });
    }
    render(); toast(`Using “${p.name}”`);
  },
  'x-preset-save': async () => {
    const x = ui.draft, ids = draftMembers(x).filter((id) => x.inc[id] !== false);
    if (ids.length < 2) return toast('Tick at least two people first.');
    const name = prompt('Name this preset, e.g. “The usual 4”', `${ids.length} people`);
    if (!name?.trim()) return;
    S.settings.presets.push({ id: uid(), name: name.trim().slice(0, 30), ids });
    await saveState(); render(); toast('Preset saved');
  },
  'x-photo-remove': () => { ui.draft.photoData = null; ui.draft.photoDirty = true; render(); },
  'view-photo': () => { ui.viewer = ui.draft?.photoData; render(); },
  'close-viewer': () => { ui.viewer = null; render(); },
  'save-expense': async () => {
    const d = ui.draft, c = draftCalc(d), desc = d.desc.trim();
    if (!desc) return toast('Type what the expense was for.');
    if (!c.amount) return toast('Enter an amount.');
    if (c.err) return toast(c.err);
    if (c.payErr) return toast(c.payErr);
    const g = group(d.groupId);
    let photoId = d.photoId;
    if (d.photoDirty) {
      // A new or changed photo always gets a new ID, so shared groups upload it once.
      if (d.photoData) { if (d.photoId) await photoDel(d.photoId); photoId = uid(); await photoPut(photoId, d.photoData); }
      else { if (d.photoId) await photoDel(d.photoId); photoId = null; }
    }
    const date = d.date || today();
    const rec = { groupId: d.groupId, desc, category: d.category, amount: c.amount, currency: d.currency, date, note: d.note.trim(), payers: c.payers, shares: c.shares,
      repeat: d.repeat, repeatDay: Number(date.slice(8, 10)), photoId,
      input: { method: d.method, inc: d.inc, vals: d.vals, payerMode: d.payerMode, payerId: d.payerId, payAmts: d.payAmts, with: d.with }, updatedAt: nowIso(), deleted: false };
    if (d.id) { Object.assign(S.expenses.find((x) => x.id === d.id), rec); log(`You edited “${desc}” in “${groupTitle(g)}”.`); }
    else { S.expenses.push({ id: uid(), createdAt: nowIso(), ...rec }); log(`You added “${desc}” (${fmt(c.amount, d.currency)}) in “${groupTitle(g)}”.`); }
    const repeated = runRepeats();
    ui.draft = null;
    await saveState();
    if (location.hash.includes('/split')) history.go(-2); else back();
    setTimeout(() => { if (location.hash.startsWith('#/expense')) { history.replaceState(null, '', `#/g/${g.id}`); render(); } }, 150);
    toast(repeated ? `Saved, plus ${repeated} repeat${repeated === 1 ? '' : 's'} that were due` : d.id ? 'Expense updated' : 'Expense added');
  },
  'delete-expense': async () => {
    const e = S.expenses.find((x) => x.id === ui.draft.id);
    if (!confirm(`Delete “${e.desc}”?`)) return;
    e.deleted = true; e.repeat = 'none'; e.updatedAt = nowIso();
    if (e.photoId) { await photoDel(e.photoId); e.photoId = null; }
    log(`You deleted “${e.desc}” in “${groupTitle(group(e.groupId) || {})}”.`);
    ui.draft = null; await saveState(); back(); toast('Expense deleted');
  },
  'new-payment': (d) => {
    const g = group(d.gid);
    const from = d.from || g.memberIds.find((id) => id !== S.me), to = d.to || S.me;
    if (!from) return toast('Add a friend first.');
    const cur = d.cur || S.settings.currency;
    ui.draft = { type: 'payment', id: null, groupId: g.id, from, to, amountStr: d.amount ? toInput(+d.amount, cur) : '', currency: cur, date: today(), note: '' };
    go('#/payment');
  },
  'edit-payment': (d) => {
    const p = S.payments.find((x) => x.id === d.id); if (!p) return;
    ui.draft = { type: 'payment', id: p.id, groupId: p.groupId, from: p.from, to: p.to, amountStr: toInput(p.amount, p.currency), currency: p.currency, date: p.date, note: p.note || '' };
    go('#/payment');
  },
  'save-payment': async () => {
    const d = ui.draft, amount = parseAmt(d.amountStr, d.currency);
    if (d.from === d.to) return toast('Pick two different people.');
    if (!amount) return toast('Enter an amount.');
    const rec = { groupId: d.groupId, from: d.from, to: d.to, amount, currency: d.currency, date: d.date || today(), note: d.note.trim(), updatedAt: nowIso(), deleted: false };
    if (d.id) Object.assign(S.payments.find((x) => x.id === d.id), rec);
    else S.payments.push({ id: uid(), createdAt: nowIso(), ...rec });
    log(`${nm(d.from)} paid ${d.to === S.me ? 'you' : nm(d.to)} ${fmt(amount, d.currency)} in “${groupTitle(group(d.groupId))}”.`);
    ui.draft = null; await saveState(); back(); toast('Payment saved');
  },
  'delete-payment': async () => {
    if (!confirm('Delete this payment?')) return;
    const p = S.payments.find((x) => x.id === ui.draft.id);
    p.deleted = true; p.updatedAt = nowIso();
    log(`You deleted a payment of ${fmt(p.amount, p.currency)} in “${groupTitle(group(p.groupId) || {})}”.`);
    ui.draft = null; await saveState(); back(); toast('Payment deleted');
  },
  'toggle-simplify': async (d) => { const g = group(d.gid); g.simplify = !g.simplify; g.updatedAt = nowIso(); await commit(); toast(g.simplify ? 'Simplify debts turned on' : 'Simplify debts turned off'); },
  'toggle-conv': (d) => { ui.conv[d.gid] = !ui.conv[d.gid]; render(); },
  'share-summary': (d) => shareText(summaryText(group(d.gid))),
  'share-image': async (d) => {
    const g = group(d.gid);
    const lines = summaryLines(g).map(({ d: x, cur }) => ({ text: `${person(x.from).name} owes ${person(x.to).name}`, amount: fmt(x.amount, cur), tone: x.to === S.me ? 'pos' : x.from === S.me ? 'neg' : '' }));
    const blob = await summaryImage(groupTitle(g), `Who owes whom · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, lines);
    const r = await shareFile(blob, `split-pay-${fileSafe(groupTitle(g))}.png`, 'image/png');
    if (r === 'downloaded') toast('Picture saved to Downloads');
  },
  'export-csv': async (d) => {
    const g = group(d.gid);
    if (!hasItems(g)) return toast('Nothing to export yet.');
    const r = await shareFile(new Blob([groupCsv(g)], { type: 'text/csv' }), `split-pay-${fileSafe(groupTitle(g))}-${today()}.csv`, 'text/csv');
    if (r === 'downloaded') toast('Spreadsheet saved to Downloads');
  },
  remind: (d) => {
    const g = group(d.gid), amt = fmt(+d.amount, d.cur);
    const text = d.to === S.me ? `Hi ${person(d.from).name}, a friendly reminder: you owe me ${amt} for “${groupTitle(g)}”. Thanks!`
      : `Reminder for “${groupTitle(g)}”: ${debtPlain(d.from, d.to, +d.amount, d.cur)}.`;
    shareText(text);
  },
  'tot-period': (d) => { ui.tot[d.gid].period = d.p; render(); },
  'tot-cur': (d) => { ui.tot[d.gid].cur = d.c; render(); },
  'tot-month': (d) => { ui.tot[d.gid].sel = +d.i; render(); },
  'g-remove': async (d) => { const g = group(d.gid); g.memberIds = g.memberIds.filter((id) => id !== d.id); g.updatedAt = nowIso(); await commit(); },
  'g-add-new': async (d) => {
    const p = addPerson(document.getElementById('g-new').value);
    if (!p) return toast('Type a name first.');
    const g = group(d.gid);
    if (!g.memberIds.includes(p.id)) g.memberIds.push(p.id);
    g.updatedAt = nowIso(); await commit();
  },
  'g-delete': async (d) => {
    const g = group(d.gid);
    if (!confirm(`Delete the group “${g.name}” and all its expenses?`)) return;
    g.deleted = true; g.updatedAt = nowIso();
    log(`You deleted the group “${g.name}”.`);
    await saveState(); history.replaceState(null, '', '#/'); render();
  },
  'f-add': async () => {
    if (!addPerson(document.getElementById('f-new').value)) return toast('Type a name first.');
    await commit();
  },
  'cat-add': async () => {
    const e = document.getElementById('cat-e').value.trim(), n = document.getElementById('cat-n').value.trim();
    if (!e || !n) return toast('Type an emoji and a name.');
    if (S.settings.categories.some((c) => c.e === e)) return toast('That emoji is already used.');
    S.settings.categories.push({ e, n }); await commit();
  },
  'cat-del': async (d) => { S.settings.categories.splice(+d.i, 1); await commit(); },
  'preset-del': async (d) => { S.settings.presets = S.settings.presets.filter((p) => p.id !== d.id); await commit(); },
  'lock-on': async () => {
    const a = document.getElementById('pin1').value, b = document.getElementById('pin2').value, err = document.getElementById('pin-err');
    if (!/^\d{4,8}$/.test(a)) { err.textContent = 'Use 4 to 8 digits.'; return; }
    if (a !== b) { err.textContent = 'The two PINs are different.'; return; }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    S.settings.lock = { salt, hash: await hashPin(a, salt), bio: null };
    await commit(); toast('App lock is on');
  },
  'lock-off': async () => {
    const pin = prompt('Type your current PIN to turn off the lock');
    if (pin === null) return;
    if (!(await pinOk(pin))) return toast('Wrong PIN.');
    S.settings.lock = null; await commit(); toast('App lock is off');
  },
  'toggle-bio': async () => {
    const L = S.settings.lock;
    if (L.bio) { L.bio = null; await commit(); return; }
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Split Pay' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: person(S.me).name, displayName: person(S.me).name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60_000,
      } });
      L.bio = b64(cred.rawId); await commit(); toast('Fingerprint unlock is on');
    } catch { toast('This phone did not allow fingerprint unlock.'); }
  },
  'toggle-theme': async () => { S.settings.theme = S.settings.theme === 'light' ? 'dark' : 'light'; await commit(); },
  backup: async () => {
    const blob = new Blob([await backupText()], { type: 'application/json' });
    const r = await shareFile(blob, `split-pay-backup-${today()}.json`, 'application/json');
    if (r === 'downloaded') toast('Backup file saved to Downloads');
  },
  restore: () => document.getElementById('restore-file').click(),
  'backup-online': async () => {
    if (ui.bk.busy) return;
    ui.bk.busy = true; render();
    try { await doOnlineBackup(); toast('Backed up online'); }
    catch (e) { if (e.code === 'need-login') { ui.bk.busy = false; return actions['need-login'](); } toast(`Online backup failed: ${syncErrorText(e.code || String(e))}`); }
    ui.bk.busy = false; render();
  },
  'open-backups': async () => {
    ui.bk.list = null; ui.bk.err = ''; go('#/account/backups');
    try { ui.bk.list = await listBackups(); } catch (e) { ui.bk.err = syncErrorText(e.code || String(e)); }
    render();
  },
  'restore-online': async (d) => {
    const b = ui.bk.list?.find((x) => x.id === d.id); if (!b) return;
    if (!confirm(`Replace all data on this phone with the online backup from ${new Date(b.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}?`)) return;
    ui.bk.busy = true; render();
    try {
      const obj = JSON.parse(await loadBackup(b.id));
      await applyBackup(obj);
      toast('Backup restored');
    } catch (e) { toast(`Restore failed: ${syncErrorText(e.code || String(e))}`); }
    ui.bk.busy = false; render();
  },

  // ---- sync (phase 7)
  'need-login': () => {
    ui.afterLogin = location.hash.startsWith('#/login') ? '#/account' : location.hash || '#/';
    Object.assign(ui.auth, { mode: 'login', err: '', info: '', password: '', password2: '' });
    go('#/login');
  },
  'auth-mode': (d) => { Object.assign(ui.auth, { mode: d.m, err: '', info: '', password: '', password2: '' }); render(); },
  'auth-submit': async () => {
    const a = ui.auth;
    if (a.busy) return;
    a.err = ''; a.info = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) a.err = 'Type your email address.';
    else if (a.mode !== 'reset' && a.password.length < 6) a.err = 'Use a password of at least 6 characters.';
    else if (a.mode === 'signup' && a.password !== a.password2) a.err = 'The two passwords are different.';
    if (a.err) return render();
    a.busy = true; render();
    try {
      if (a.mode === 'reset') { await resetPassword(a.email); a.info = 'If this email has an account, a reset link is on its way. Check your inbox (and spam).'; a.mode = 'login'; }
      else {
        if (a.mode === 'signup') await createAccount(a.email, a.password); else await logIn(a.email, a.password);
        Object.assign(a, { password: '', password2: '' });
        toast(a.mode === 'signup' ? 'Account created' : 'Logged in');
        setTimeout(autoBackup, 3000);
      }
    } catch (e) { sync.error = ''; a.err = syncErrorText.call(null, e.code || String(e)); }
    a.busy = false; render();
  },
  'sign-out': async () => {
    if (!confirm('Log out? You will need your email and password to open Split Pay again. Your data stays on this phone.')) return;
    await signOut(); ui.bk.list = null; render(); toast('Logged out');
  },
  'share-group': async (d) => {
    const g = group(d.gid);
    if (!confirm(`Share “${g.name}”? It will be stored online in Google Firebase so friends with the invite link can join.`)) return;
    sync.busy = 'share'; sync.error = ''; render();
    try {
      await shareGroup(g);
      log(`You shared the group “${g.name}”.`);
      await saveState();
      toast('Group shared. Now send the invite link.');
    } catch (e) {
      if (e.code === 'need-login') { sync.busy = ''; return actions['need-login'](); }
      sync.error = e.code || String(e); toast(syncErrorText());
    }
    sync.busy = ''; render();
  },
  'send-invite': (d) => {
    const g = group(d.gid);
    shareText(`Join “${g.name}” on Split Pay, so we can all add expenses: ${inviteLink(g)}`);
  },
  'join-retry': async (d) => {
    sync.error = ''; render();
    try { await joinGroup(d.gid, d.code); } catch (e) { sync.error = e.code || String(e); }
    render();
  },
  claim: async (d) => {
    const g = group(d.gid), name = person(d.id).name;
    if (!confirm(`You are ${name} in “${g.name}”? Everything under ${name} becomes yours.`)) return;
    try {
      await claimName(g, d.id);
      log(`You joined “${g.name}” as ${name}.`);
      await saveState();
      history.replaceState(null, '', `#/g/${g.id}`); render(); toast(`Welcome to ${g.name}`);
    } catch (e) { sync.error = e.code || String(e); toast(syncErrorText()); }
  },
  'add-me': async (d) => {
    const g = group(d.gid);
    try {
      await addMeTo(g);
      log(`You joined “${g.name}”.`);
      await saveState();
      history.replaceState(null, '', `#/g/${g.id}`); render(); toast(`Welcome to ${g.name}`);
    } catch (e) { sync.error = e.code || String(e); toast(syncErrorText()); }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset, el);
});

// ---------------------------------------------------------------- inputs
let wbTimer;
const inputs = {
  d: (v, ds) => { ui.draft[ds.k] = v; if (ds.re) render(); },
  'x-amount': (v) => { ui.draft.amountStr = v; refreshSplit(); },
  'x-cur': (v) => { ui.draft.currency = v; refreshSplit(); },
  'x-group': (v) => { const x = ui.draft; x.groupId = v; x.inc = {}; x.vals = {}; x.payAmts = {}; x.with = {}; x.payerMode = 'single'; x.payerId = S.me; x.method = 'equal'; render(); },
  'x-val': (v, ds) => { ui.draft.vals[ds.id] = v; refreshSplit(); },
  'x-pay': (v, ds) => { ui.draft.payAmts[ds.id] = v; refreshSplit(); },
  'x-payer': (v) => { const x = ui.draft; if (v === '*') x.payerMode = 'multi'; else { x.payerMode = 'single'; x.payerId = v; } render(); },
  'g-name': (v, ds) => { const g = group(ds.gid); if (v.trim()) { g.name = v.trim(); g.updatedAt = nowIso(); saveState(); } },
  'g-type': async (v, ds) => { const g = group(ds.gid); g.type = v; g.updatedAt = nowIso(); await commit(); },
  'g-date': (v, ds) => { const g = group(ds.gid); g[ds.k] = v; g.updatedAt = nowIso(); saveState(); },
  'g-add': async (v, ds) => { if (!v) return; const g = group(ds.gid); g.memberIds.push(v); g.updatedAt = nowIso(); await commit(); },
  wb: (v, ds) => { const g = group(ds.gid); g.whiteboard = v; g.updatedAt = nowIso(); clearTimeout(wbTimer); wbTimer = setTimeout(saveState, 400); },
  search: (v) => { ui.q = v; document.getElementById('results').innerHTML = searchResults(); },
  rate: (v, ds) => { S.settings.rates[ds.c] = v.trim(); saveState(); },
  'me-name': (v) => { if (v.trim()) { person(S.me).name = v.trim(); saveState(); } },
  'set-cur': (v) => { S.settings.currency = v; saveState(); },
  auth: (v, ds) => { ui.auth[ds.k] = v; },
};
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]');
  if (el && inputs[el.dataset.in]) inputs[el.dataset.in](el.value, el.dataset, el);
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'x-photo-file' && e.target.files[0]) {
    try {
      ui.draft.photoData = await compressImage(e.target.files[0]);
      ui.draft.photoDirty = true;
      render();
    } catch { toast('Could not read that picture.'); }
    return;
  }
  if (e.target.id !== 'restore-file' || !e.target.files[0]) return;
  try {
    const obj = JSON.parse(await e.target.files[0].text());
    if (!isBackup(obj)) throw new Error('not a backup');
    if (!confirm(`Replace all data on this device with the backup from ${String(obj.exportedAt).slice(0, 10)}?`)) return;
    await applyBackup(obj);
    toast('Backup restored');
  } catch { toast('That file is not a Split Pay backup.'); }
  e.target.value = '';
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'ob-name') actions.onboard();
  if (e.target.id === 'lock-pin') actions.unlock();
  if (e.target.id?.startsWith('auth-')) actions['auth-submit']();
});

// ------------------------------------------------------------------ boot
(async () => {
  try {
    await loadCore();
    const saved = await kvGet('state');
    S = saved ? migrate(saved) : null;
    if (S) {
      ui.locked = !!S.settings.lock;
      if (runRepeats()) await saveState();
    }
    initSync({ getS: () => S, saveQuiet, rerender: (soft) => (soft ? softRender() : render()), toast, log, nm, nowIso });
    render(); // shows "Split Pay" while the log-in check runs
    start().catch(() => { ui.authFailed = true; }).then(() => { render(); autoBackup(); });
  } catch (err) {
    $app.innerHTML = `<div class="page"><div class="empty"><b>Split Pay could not start</b>${esc(err.message || err)}</div></div>`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();

// Pure merge rules for sync (phase 7). No Firebase here, so it can be tested on its own.
//
// Data online:
//   groups/{groupId}          the group row + memberUids, uids {personId: userId}, claims {oldId: newId}, people {personId: {name, color}}, inviteCode
//   groups/{groupId}/items/*  one expense (kind 'e') or payment (kind 'p'), same fields as on the phone
//
// A person's ID is their identity. When a friend claims a name ("I am Juju"), the name's
// placeholder ID is replaced by the friend's own ID everywhere, and the swap is written to
// `claims` so every other phone does the same swap.

export const GROUP_FIELDS = ['name', 'type', 'memberIds', 'simplify', 'whiteboard', 'tripStart', 'tripEnd', 'deleted', 'updatedAt'];

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] ?? (k === 'deleted' || k === 'simplify' ? false : k === 'memberIds' ? [] : '')]));
const dedupe = (a) => [...new Set(a)];

/** Sum entries that end up with the same person after a rename. */
function mergeAmts(list, sw) {
  const out = [];
  for (const a of list || []) {
    const id = sw(a.id), hit = out.find((x) => x.id === id);
    if (hit) hit.amount += a.amount; else out.push({ ...a, id });
  }
  return out;
}
function renameKeys(obj, from, to) {
  if (!obj || !(from in obj)) return obj;
  const out = { ...obj };
  if (!(to in out)) out[to] = out[from];
  delete out[from];
  return out;
}
/** Does this row mention the person? */
export function rowHas(row, pid) {
  if (row.payers) return [...row.payers, ...row.shares].some((a) => a.id === pid) || row.input?.payerId === pid;
  return row.from === pid || row.to === pid;
}
function renameInRow(row, from, to) {
  const sw = (id) => (id === from ? to : id);
  if (row.payers) {
    row.payers = mergeAmts(row.payers, sw);
    row.shares = mergeAmts(row.shares, sw);
    if (row.input) {
      const i = row.input;
      i.payerId = sw(i.payerId);
      for (const k of ['inc', 'vals', 'payAmts', 'with']) i[k] = renameKeys(i[k], from, to);
    }
  } else { row.from = sw(row.from); row.to = sw(row.to); }
}

export const hasPerson = (S, pid) => S.people.some((p) => p.id === pid);

/** Replace person `from` by `to` everywhere on this phone. Does not change any updatedAt. */
export function renamePerson(S, from, to) {
  if (!from || !to || from === to) return;
  const sw = (id) => (id === from ? to : id);
  const fromP = S.people.find((p) => p.id === from), toP = S.people.find((p) => p.id === to);
  if (fromP && !toP) fromP.id = to;
  else if (fromP && toP) {
    if (S.me === from) { toP.name = fromP.name; toP.color = fromP.color; }
    S.people = S.people.filter((p) => p !== fromP);
  }
  if (S.me === from) S.me = to;
  for (const g of S.groups) {
    g.memberIds = dedupe((g.memberIds || []).map(sw));
    if (g.uids) g.uids = renameKeys(g.uids, from, to);
  }
  for (const e of S.expenses) if (rowHas(e, from)) renameInRow(e, from, to);
  for (const p of S.payments) if (rowHas(p, from)) renameInRow(p, from, to);
  for (const pr of S.settings?.presets || []) pr.ids = dedupe(pr.ids.map(sw));
}

/** The people of a group, as stored online. */
export function peopleMap(S, g) {
  const out = {};
  for (const id of g.memberIds) { const p = S.people.find((x) => x.id === id); if (p) out[id] = { name: p.name, color: p.color || '#888' }; }
  return out;
}
/** Fingerprint of what is uploaded for a group; a change means "upload again". */
export const groupSig = (S, g) => JSON.stringify([pick(g, GROUP_FIELDS), peopleMap(S, g)]);
export const groupFields = (g) => pick(g, GROUP_FIELDS);

/**
 * Apply a group document that arrived from Firebase.
 * Returns { isNew, changed }.
 */
export function applyGroup(S, id, r, myUid) {
  S.sync ||= { pushed: {} };
  // Same Google account on another phone: adopt the ID this account already has online.
  const mine = Object.keys(r.uids || {}).find((p) => r.uids[p] === myUid);
  if (mine && mine !== S.me) renamePerson(S, S.me, mine);
  // Names that friends claimed.
  for (const [from, to] of Object.entries(r.claims || {})) if (from !== to && hasPerson(S, from)) renamePerson(S, from, to);
  // People.
  const ng = S.groups.find((g) => g.nongroup);
  for (const [pid, p] of Object.entries(r.people || {})) {
    const lp = S.people.find((x) => x.id === pid);
    if (!lp) {
      S.people.push({ id: pid, name: p.name, color: p.color || '#888', updatedAt: r.updatedAt || '' });
      if (ng && !ng.memberIds.includes(pid)) ng.memberIds.push(pid);
    } else if (pid !== S.me) { lp.name = p.name; lp.color = p.color || lp.color; }
  }
  // The group itself: newest change wins.
  let g = S.groups.find((x) => x.id === id), isNew = false, changed = false;
  if (!g) { g = { id, createdAt: r.createdAt || r.updatedAt || '', ...groupFields(r) }; S.groups.push(g); isNew = true; changed = true; }
  else if (!g.updatedAt || (r.updatedAt || '') >= g.updatedAt) {
    const before = JSON.stringify(groupFields(g));
    Object.assign(g, groupFields(r));
    changed = before !== JSON.stringify(groupFields(g));
  }
  g.shared = true;
  g.inviteCode = r.inviteCode || '';
  g.uids = { ...(r.uids || {}) };
  g.claims = { ...(r.claims || {}) };
  g.ownerUid = r.ownerUid || '';
  S.sync.pushed['g:' + id] = groupSig(S, g);
  return { isNew, changed };
}

/**
 * Apply one expense/payment that arrived from Firebase.
 * Returns 'new', 'updated' or '' (nothing to do).
 */
export function applyItem(S, r, claims = {}) {
  S.sync ||= { pushed: {} };
  const row = structuredClone(r);
  const kind = row.kind; delete row.kind; delete row.by;
  for (const [from, to] of Object.entries(claims)) if (rowHas(row, from)) renameInRow(row, from, to);
  const list = kind === 'p' ? S.payments : S.expenses;
  const local = list.find((x) => x.id === row.id);
  let res = '';
  if (!local) { list.push(row); res = 'new'; }
  else if ((row.updatedAt || '') > (local.updatedAt || '')) {
    const photoId = local.photoId;
    for (const k of Object.keys(local)) delete local[k];
    Object.assign(local, row);
    if (kind !== 'p' && photoId && !row.photoId) local.photoId = photoId;
    res = 'updated';
  }
  S.sync.pushed[row.id] = (local || row).updatedAt;
  return res;
}

/** What this phone still has to upload. */
export function dirty(S) {
  const pushed = S.sync?.pushed || {};
  const groups = [], items = [];
  for (const g of S.groups) {
    if (!g.shared || g.nongroup) continue;
    if (pushed['g:' + g.id] !== groupSig(S, g)) groups.push(g);
    for (const e of S.expenses) if (e.groupId === g.id && pushed[e.id] !== e.updatedAt) items.push({ kind: 'e', row: e });
    for (const p of S.payments) if (p.groupId === g.id && pushed[p.id] !== p.updatedAt) items.push({ kind: 'p', row: p });
  }
  return { groups, items };
}

/** Firestore refuses `undefined`; also drop phone-only fields. */
export function clean(row) {
  const out = JSON.parse(JSON.stringify(row));
  return out;
}

/** Short random code for invite links. */
export function inviteCode() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => a[b % a.length]).join('');
}

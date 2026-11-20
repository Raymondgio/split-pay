// Sync with friends through Firebase (phase 7): Google sign-in + Firestore.
// Firebase is loaded only when needed, so the app still opens instantly and offline.
import { firebaseConfig } from './firebase-config.js';
import { applyGroup, applyItem, dirty, clean, groupFields, groupSig, peopleMap, renamePerson, rowHas, inviteCode } from './syncmerge.js';
import { photoGet, photoPut, shrinkDataUrl } from './media.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.14.1';
let fb = null, loading = null, H = null;
let groupsUnsub = null;
const itemUnsubs = new Map(); // groupId -> unsubscribe
const primed = new Set();     // groups whose first item snapshot has arrived
let pushTimer = null;

/** Live status, read by the screens. */
export const sync = { user: null, ready: false, error: '', busy: '' };

/** hooks: getS(), saveQuiet(), rerender(), toast(msg), log(text), nm(id), nowIso() */
export function initSync(hooks) { H = hooks; }

async function load() {
  if (fb) return fb;
  loading ||= (async () => {
    const [app, auth, fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-firestore.js`)]);
    const a = app.initializeApp(firebaseConfig);
    const db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    const au = auth.getAuth(a);
    fb = { auth, fs, db, au };
    await new Promise((resolve) => {
      auth.onAuthStateChanged(au, (u) => {
        sync.user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '' } : null;
        sync.ready = true;
        onUser();
        resolve();
      });
    });
    return fb;
  })();
  try { return await loading; } catch (e) { loading = null; throw e; }
}

/** Start loading Firebase early, so the Google pop-up opens right after the tap (browsers block late pop-ups). */
export function warm() { if (!fb) load().catch(() => {}); }

/** Called at start-up: reconnect if this phone was signed in before. */
export async function resume() {
  const S = H.getS();
  if (!S?.sync?.uid) return;
  try { await load(); } catch { sync.error = 'offline'; }
}

export async function signIn() {
  const { auth, au } = await load();
  if (sync.user) return sync.user;
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await auth.signInWithPopup(au, provider);
  return sync.user;
}
export async function signOut() {
  const { auth, au } = await load();
  await auth.signOut(au);
}

function stopAll() {
  groupsUnsub?.(); groupsUnsub = null;
  for (const u of itemUnsubs.values()) u();
  itemUnsubs.clear(); primed.clear();
}

async function onUser() {
  const S = H.getS();
  stopAll();
  if (!S) return;
  S.sync ||= { pushed: {} };
  if (!sync.user) { S.sync.uid = null; await H.saveQuiet(); H.rerender(); return; }
  S.sync.uid = sync.user.uid;
  await H.saveQuiet();
  const { fs, db } = fb;
  const q = fs.query(fs.collection(db, 'groups'), fs.where('memberUids', 'array-contains', sync.user.uid));
  groupsUnsub = fs.onSnapshot(q, (snap) => {
    const S2 = H.getS();
    let touched = false;
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') { const g = S2.groups.find((x) => x.id === id); if (g) { g.shared = false; touched = true; } itemUnsubs.get(id)?.(); itemUnsubs.delete(id); continue; }
      if (ch.doc.metadata.hasPendingWrites) continue; // our own change, already applied
      const { isNew, changed } = applyGroup(S2, id, ch.doc.data(), sync.user.uid);
      if (isNew) H.log(`You joined the shared group “${ch.doc.data().name}”.`);
      touched = true;
      if (!itemUnsubs.has(id)) watchItems(id);
    }
    sync.error = '';
    if (touched) { H.saveQuiet(); H.rerender(true); }
  }, (err) => { sync.error = err.code || String(err); H.rerender(true); });
  schedulePush();
}

function watchItems(gid) {
  const { fs, db } = fb;
  const u = fs.onSnapshot(fs.collection(db, 'groups', gid, 'items'), (snap) => {
    const S = H.getS();
    const g = S.groups.find((x) => x.id === gid);
    let touched = false;
    for (const ch of snap.docChanges()) {
      if (ch.doc.metadata.hasPendingWrites) continue;
      const r = ch.doc.data();
      const res = applyItem(S, r, g?.claims || {});
      if (!res) continue;
      touched = true;
      if (r.photoId) fetchPhoto(gid, r.photoId); // keep a copy on this phone, so it also shows offline
      if (primed.has(gid) && r.by && r.by !== S.me) {
        const what = r.kind === 'p' ? `a payment of ${r.currency}` : `“${r.desc}”`;
        H.log(`${H.nm(r.by)} ${r.deleted ? 'deleted' : res === 'new' ? 'added' : 'edited'} ${what} in “${g?.name || 'a group'}”.`);
      }
    }
    primed.add(gid);
    if (touched) { H.saveQuiet(); H.rerender(true); }
  }, (err) => { sync.error = err.code || String(err); });
  itemUnsubs.set(gid, u);
}

/** Upload whatever changed on this phone. Called after every save. */
export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 400);
}
async function push() {
  const S = H.getS();
  if (!fb || !sync.user || !S) return;
  const { fs, db } = fb;
  const { groups, items } = dirty(S);
  if (!groups.length && !items.length) return pushPhotos();
  for (const g of groups) {
    fs.updateDoc(fs.doc(db, 'groups', g.id), { ...groupFields(g), people: peopleMap(S, g) }).catch(fail);
    S.sync.pushed['g:' + g.id] = groupSig(S, g);
  }
  for (const { kind, row } of items) {
    fs.setDoc(fs.doc(db, 'groups', row.groupId, 'items', row.id), { ...clean(row), kind, by: S.me }).catch(fail);
    S.sync.pushed[row.id] = row.updatedAt;
  }
  await H.saveQuiet();
  await pushPhotos();
}

// ---------------------------------------------------------------- photos
// A shared group's receipt photos live at groups/{groupId}/photos/{photoId} as a small JPEG.
// A changed photo always gets a new photoId, so a photo is uploaded once and never edited.
async function pushPhotos() {
  const S = H.getS();
  const { fs, db } = fb;
  const shared = new Set(S.groups.filter((g) => g.shared && !g.nongroup).map((g) => g.id));
  for (const e of S.expenses) {
    if (!e.photoId || e.deleted || !shared.has(e.groupId) || S.sync.pushed['ph:' + e.photoId]) continue;
    const data = await photoGet(e.photoId);
    if (!data) continue; // the photo lives on another phone
    const small = await shrinkDataUrl(data);
    if (!small) continue;
    S.sync.pushed['ph:' + e.photoId] = true;
    fs.setDoc(fs.doc(db, 'groups', e.groupId, 'photos', e.photoId), { data: small, expenseId: e.id, by: S.me, updatedAt: H.nowIso() })
      .catch((err) => { delete S.sync.pushed['ph:' + e.photoId]; fail(err); });
  }
  await H.saveQuiet();
}

const fetching = new Map();
/** Get a shared photo from Firebase and keep it on this phone. Returns the picture or null. */
export function fetchPhoto(gid, photoId) {
  if (!fb || !photoId) return Promise.resolve(null);
  if (fetching.has(photoId)) return fetching.get(photoId);
  const p = (async () => {
    const have = await photoGet(photoId);
    if (have) return have;
    const { fs, db } = fb;
    const snap = await fs.getDoc(fs.doc(db, 'groups', gid, 'photos', photoId));
    const data = snap.exists() ? snap.data().data : null;
    if (data) {
      await photoPut(photoId, data);
      const S = H.getS();
      S.sync.pushed['ph:' + photoId] = true; // already online, no need to upload it back
      await H.saveQuiet();
      H.rerender(true);
    }
    return data;
  })().catch(() => null).finally(() => fetching.delete(photoId));
  fetching.set(photoId, p);
  return p;
}
function fail(err) {
  sync.error = err?.code || String(err);
  H.toast(sync.error === 'permission-denied' ? 'Sync was refused. Are you still in this group?' : 'Sync problem. It will retry when online.');
}

/** Put a group online and get its invite link. */
export async function shareGroup(g) {
  await signIn();
  const S = H.getS();
  const { fs, db } = fb;
  const uid = sync.user.uid, code = inviteCode(), now = H.nowIso();
  g.updatedAt = now;
  const data = { ...groupFields(g), createdAt: g.createdAt || now, people: peopleMap(S, g), memberUids: [uid], ownerUid: uid, uids: { [S.me]: uid }, claims: {}, inviteCode: code };
  await fs.setDoc(fs.doc(db, 'groups', g.id), data);
  Object.assign(g, { shared: true, inviteCode: code, uids: data.uids, claims: {}, ownerUid: uid });
  S.sync.pushed['g:' + g.id] = groupSig(S, g);
  await H.saveQuiet();
  if (!itemUnsubs.has(g.id)) watchItems(g.id);
  await push();
}

export const inviteLink = (g) => `${location.origin}${location.pathname}#/join/${g.id}/${g.inviteCode}`;

/** Add this account to a group, using the code from the invite link. */
export async function joinGroup(gid, code) {
  await signIn();
  const { fs, db } = fb;
  await fs.updateDoc(fs.doc(db, 'groups', gid), { memberUids: fs.arrayUnion(sync.user.uid), lastJoinCode: code });
}

/** "I am Juju": the placeholder person becomes this phone's own person. */
export async function claimName(g, pid) {
  const S = H.getS();
  const { fs, db } = fb;
  const now = H.nowIso(), me = S.me;
  for (const r of [...S.expenses, ...S.payments]) if (r.groupId === g.id && rowHas(r, pid)) r.updatedAt = now;
  renamePerson(S, pid, me);
  g.uids = { ...g.uids, [me]: sync.user.uid };
  g.claims = { ...g.claims, [pid]: me };
  g.updatedAt = now;
  await fs.updateDoc(fs.doc(db, 'groups', g.id),
    'memberIds', g.memberIds, 'people', peopleMap(S, g), 'updatedAt', now,
    new fs.FieldPath('uids', me), sync.user.uid, new fs.FieldPath('claims', pid), me);
  S.sync.pushed['g:' + g.id] = groupSig(S, g);
  await H.saveQuiet();
  await push();
}

/** "I'm not on the list": add this phone's person to the group. */
export async function addMeTo(g) {
  const S = H.getS();
  const { fs, db } = fb;
  const now = H.nowIso(), me = S.me;
  if (!g.memberIds.includes(me)) g.memberIds.push(me);
  g.uids = { ...g.uids, [me]: sync.user.uid };
  g.updatedAt = now;
  await fs.updateDoc(fs.doc(db, 'groups', g.id), 'memberIds', g.memberIds, 'people', peopleMap(S, g), 'updatedAt', now, new fs.FieldPath('uids', me), sync.user.uid);
  S.sync.pushed['g:' + g.id] = groupSig(S, g);
  await H.saveQuiet();
}

/** Has this account picked who it is in the group? */
export const claimedHere = (g) => !!sync.user && Object.values(g.uids || {}).includes(sync.user.uid);

// 모든 페이지에서 공통으로 쓰는 Firebase 인증 + Firestore 로직
import { firebaseConfig, SITE_OWNER_EMAILS } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  increment,
  serverTimestamp,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  collectionGroup,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ---------- 로그인 / 로그아웃 ----------
export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, provider);
  await ensureUserDoc(result.user);
  return result.user;
}

export async function signOutUser() {
  await signOut(auth);
}

// 로그인 상태가 바뀔 때마다 callback(user | null) 실행
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// users/{uid} 문서가 없으면 새로 만들어줌 (최초 로그인 시)
export async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      subscriptions: [],
      createdAt: serverTimestamp(),
    });
  }
  return ref;
}

export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export function isSiteOwner(email) {
  return !!email && SITE_OWNER_EMAILS.includes(email);
}

// ---------- 전역 권한 (permissions/{email}) ----------
// 사이트 관리자(SITE_OWNER_EMAILS)가 다른 계정에게 "시리즈 생성 권한" / "시리즈 삭제 권한"을 부여할 수 있음
export async function getPermissions(email) {
  if (!email) return { canCreateSeries: false, canDeleteSeries: false };
  const snap = await getDoc(doc(db, "permissions", email));
  return snap.exists() ? snap.data() : { canCreateSeries: false, canDeleteSeries: false };
}

// field: "canCreateSeries" | "canDeleteSeries"
export async function setPermission(email, field, enabled) {
  await setDoc(doc(db, "permissions", email), { [field]: enabled }, { merge: true });
}

export async function canUserCreateSeries(email) {
  if (isSiteOwner(email)) return true;
  const perm = await getPermissions(email);
  return !!(perm && perm.canCreateSeries);
}

export async function canUserDeleteSeries(email) {
  if (isSiteOwner(email)) return true;
  const perm = await getPermissions(email);
  return !!(perm && perm.canDeleteSeries);
}

// ---------- 구독 ----------
export async function subscribeToSeries(uid, seriesId) {
  await updateDoc(doc(db, "users", uid), {
    subscriptions: arrayUnion(seriesId),
  });
}

export async function unsubscribeFromSeries(uid, seriesId) {
  await updateDoc(doc(db, "users", uid), {
    subscriptions: arrayRemove(seriesId),
  });
}

// ---------- 시리즈 ----------
export async function createSeries({ name, description, thumbnail, ownerEmails, creatorEmail }) {
  const ref = await addDoc(collection(db, "series"), {
    name,
    description: description || "",
    thumbnail: thumbnail || "",
    ownerEmails: Array.from(new Set([...(ownerEmails || []), creatorEmail])),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function addSeriesOwner(seriesId, email) {
  await updateDoc(doc(db, "series", seriesId), {
    ownerEmails: arrayUnion(email),
  });
}

export async function removeSeriesOwner(seriesId, email) {
  await updateDoc(doc(db, "series", seriesId), {
    ownerEmails: arrayRemove(email),
  });
}

export async function updateSeries(seriesId, { name, description, thumbnail }) {
  const data = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (thumbnail !== undefined) data.thumbnail = thumbnail;
  await updateDoc(doc(db, "series", seriesId), data);
}

export async function deleteSeries(seriesId) {
  // 하위 영상들을 먼저 삭제한 뒤 시리즈 문서를 삭제
  const videosSnap = await getDocs(collection(db, "series", seriesId, "videos"));
  await Promise.all(videosSnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "series", seriesId));
}

export async function getSeries(seriesId) {
  const snap = await getDoc(doc(db, "series", seriesId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllSeries() {
  const snap = await getDocs(collection(db, "series"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 현재 로그인한 사람이 이 시리즈에 업로드 권한이 있는지 확인
export function canUploadToSeries(series, userEmail) {
  if (!series || !userEmail) return false;
  return (series.ownerEmails || []).includes(userEmail);
}

// ---------- 비디오 ----------
export async function addVideoToSeries(seriesId, { title, thumbnailUrl, youtubeUrl, uploaderEmail }) {
  const ref = await addDoc(collection(db, "series", seriesId, "videos"), {
    title,
    thumbnailUrl,
    youtubeUrl,
    uploaderEmail,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateVideo(seriesId, videoId, { title, thumbnailUrl }) {
  const data = {};
  if (title !== undefined) data.title = title;
  if (thumbnailUrl !== undefined) data.thumbnailUrl = thumbnailUrl;
  await updateDoc(doc(db, "series", seriesId, "videos", videoId), data);
}

export async function deleteVideoFromSeries(seriesId, videoId) {
  await deleteDoc(doc(db, "series", seriesId, "videos", videoId));
}

export async function getVideosForSeries(seriesId) {
  const q = query(
    collection(db, "series", seriesId, "videos"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 홈 화면 "추천 비디오" - 모든 시리즈의 영상을 모아서 무작위 순서로 섞어 반환
// (collectionGroup + orderBy 쿼리는 Firestore 콘솔에서 별도 색인을 만들어야 하고,
//  색인이 없으면 조회가 통째로 실패해서 "불러오는 중..."에 멈춰버리는 문제가 있었음.
//  그래서 시리즈별로 단순 조회한 뒤 클라이언트에서 합쳐서 섞는 방식으로 바꿈)
export async function getRandomRecommendedVideos(count = 12) {
  const allSeries = await getAllSeries();
  const lists = await Promise.all(
    allSeries.map(async (s) => {
      const vids = await getVideosForSeries(s.id);
      return vids.map((v) => ({ ...v, seriesId: s.id }));
    })
  );
  const all = lists.flat();
  // Fisher-Yates 셔플
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

export async function getVideo(seriesId, videoId) {
  const snap = await getDoc(doc(db, "series", seriesId, "videos", videoId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ---------- 조회수 ----------
export async function incrementVideoView(seriesId, videoId) {
  await updateDoc(doc(db, "series", seriesId, "videos", videoId), {
    views: increment(1),
  });
}

// ---------- 영상 좋아요 (계정당 1개, 토글) ----------
export async function likeVideo(seriesId, videoId, uid) {
  await updateDoc(doc(db, "series", seriesId, "videos", videoId), {
    likes: arrayUnion(uid),
  });
}

export async function unlikeVideo(seriesId, videoId, uid) {
  await updateDoc(doc(db, "series", seriesId, "videos", videoId), {
    likes: arrayRemove(uid),
  });
}

// ---------- 댓글 (계정당 1개, 댓글 문서 ID = uid) ----------
export async function getComments(seriesId, videoId) {
  const snap = await getDocs(
    query(collection(db, "series", seriesId, "videos", videoId, "comments"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMyComment(seriesId, videoId, uid) {
  const snap = await getDoc(doc(db, "series", seriesId, "videos", videoId, "comments", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertComment(seriesId, videoId, uid, { authorName, authorPhoto, text }) {
  const ref = doc(db, "series", seriesId, "videos", videoId, "comments", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { text, authorName, authorPhoto });
  } else {
    await setDoc(ref, { text, authorName, authorPhoto: authorPhoto || "", likes: [], createdAt: serverTimestamp() });
  }
}

export async function deleteComment(seriesId, videoId, uid) {
  await deleteDoc(doc(db, "series", seriesId, "videos", videoId, "comments", uid));
}

export async function likeComment(seriesId, videoId, commentUid, likerUid) {
  await updateDoc(doc(db, "series", seriesId, "videos", videoId, "comments", commentUid), {
    likes: arrayUnion(likerUid),
  });
}

export async function unlikeComment(seriesId, videoId, commentUid, likerUid) {
  await updateDoc(doc(db, "series", seriesId, "videos", videoId, "comments", commentUid), {
    likes: arrayRemove(likerUid),
  });
}

// ---------- 더미 데이터 (관리자 테스트용) ----------
// 더미 시리즈/영상/댓글: 실제 내용(썸네일, 유튜브 링크, 댓글 내용 등) 없이
// 제목 등 형식만 채워서 만드는 테스트용 데이터. 문서에 isDummy:true를 남겨서
// 일반 데이터와 구분하고, 몇 번째 더미인지 세는 데도 사용한다.

// 전체 시리즈 중 더미 시리즈만 골라 반환
export async function getDummySeries() {
  const all = await getAllSeries();
  return all.filter((s) => s.isDummy);
}

// 더미 시리즈가 하나도 없으면 새로 만들고, 있으면 그중 첫 번째를 반환한다.
// ("더미 시리즈는 최소 1개 존재" 조건을 보장 + 더미 영상이 기본으로 담길 시리즈를 정해줌)
export async function ensureDummySeries(creatorEmail) {
  const dummySeries = await getDummySeries();
  if (dummySeries.length > 0) return dummySeries[0];
  return createDummySeries(creatorEmail);
}

// 더미 시리즈 새로 생성. 이름: 더미 시리즈 -> 더미 시리즈1 -> 더미 시리즈2 ...
export async function createDummySeries(creatorEmail) {
  const dummyCount = (await getDummySeries()).length;
  const name = dummyCount === 0 ? "더미 시리즈" : `더미 시리즈${dummyCount}`;
  const ownerEmails = creatorEmail ? [creatorEmail] : [];
  const ref = await addDoc(collection(db, "series"), {
    name,
    description: "",
    thumbnail: "",
    ownerEmails,
    isDummy: true,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, name, description: "", thumbnail: "", ownerEmails, isDummy: true };
}

// 더미 영상 생성 (지정한 시리즈에 담김, 보통 ensureDummySeries로 구한 더미 시리즈).
// 제목: 더미제목 -> 더미제목1 -> 더미제목2 ... (같은 시리즈 안 더미 영상 개수 기준)
export async function createDummyVideo(seriesId, uploaderEmail) {
  const existing = await getVideosForSeries(seriesId);
  const dummyCount = existing.filter((v) => v.isDummy).length;
  const title = dummyCount === 0 ? "더미제목" : `더미제목${dummyCount}`;
  const ref = await addDoc(collection(db, "series", seriesId, "videos"), {
    title,
    thumbnailUrl: "",
    youtubeUrl: "",
    uploaderEmail: uploaderEmail || "",
    isDummy: true,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, title, thumbnailUrl: "", youtubeUrl: "", isDummy: true };
}

// 더미 댓글 생성. 일반 댓글과 달리 문서 ID가 uid가 아니라 자동 생성 ID라서
// "계정당 1개" 제한과 무관하게 여러 개 계속 추가될 수 있다.
// 텍스트: 더미 댓글 -> 더미 댓글1 -> 더미 댓글2 ...
export async function createDummyComment(seriesId, videoId) {
  const existing = await getComments(seriesId, videoId);
  const dummyCount = existing.filter((c) => c.isDummy).length;
  const text = dummyCount === 0 ? "더미 댓글" : `더미 댓글${dummyCount}`;
  const ref = await addDoc(collection(db, "series", seriesId, "videos", videoId, "comments"), {
    authorName: "더미 계정",
    authorPhoto: "",
    text,
    likes: [],
    isDummy: true,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, text, authorName: "더미 계정", isDummy: true };
}

// 전체 시리즈를 뒤져서 isDummy:true 인 영상을 전부 모아 반환 (일괄/선택 삭제용).
// 각 항목에 seriesId/seriesName을 함께 담아줘서 삭제 시 바로 쓸 수 있게 한다.
export async function getAllDummyVideos() {
  const allSeries = await getAllSeries();
  const lists = await Promise.all(
    allSeries.map(async (s) => {
      const vids = await getVideosForSeries(s.id);
      return vids
        .filter((v) => v.isDummy)
        .map((v) => ({ ...v, seriesId: s.id, seriesName: s.name }));
    })
  );
  return lists.flat();
}

// ---------- HYUNIL TIER (티어메이커) ----------
// 컬렉션 구조: tiers/{tierId}
//   title        : 티어표 제목
//   description  : 설명(선택)
//   coverUrl     : 목록 카드에 쓸 커버 이미지 URL(선택, 비우면 박스 이미지로 콜라주)
//   rows         : [{ label, color }]  — 티어 행(S/A/B/C/D ...)
//   items        : [{ id, name, imageUrl }] — 박스 목록(만든 사람이 정한 순서 그대로)
//   creatorEmail / creatorName / creatorPhoto
//   plays        : 누군가 이 티어표를 열어본 횟수
// 만드는 건 로그인한 사람 누구나 가능하고, 고치거나 지우는 건 만든 사람과 관리자만 가능.

export async function createTier({ title, description, coverUrl, rows, items, creatorEmail, creatorName, creatorPhoto }) {
  const ref = await addDoc(collection(db, "tiers"), {
    title,
    description: description || "",
    coverUrl: coverUrl || "",
    rows: rows || [],
    items: items || [],
    creatorEmail: creatorEmail || "",
    creatorName: creatorName || "",
    creatorPhoto: creatorPhoto || "",
    plays: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// 전체 티어표 목록. 최신순 정렬은 클라이언트에서 처리한다.
// (orderBy를 서버 쿼리에 넣으면 색인이 필요하거나, createdAt이 아직 확정되지 않은
//  문서가 통째로 빠지는 문제가 있어서 예전에 추천 비디오에서 겪었던 함정과 같음)
export async function getAllTiers() {
  const snap = await getDocs(collection(db, "tiers"));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => {
    const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
  return list;
}

export async function getTier(tierId) {
  const snap = await getDoc(doc(db, "tiers", tierId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateTier(tierId, { title, description, coverUrl, rows, items }) {
  const data = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (coverUrl !== undefined) data.coverUrl = coverUrl;
  if (rows !== undefined) data.rows = rows;
  if (items !== undefined) data.items = items;
  await updateDoc(doc(db, "tiers", tierId), data);
}

export async function deleteTier(tierId) {
  await deleteDoc(doc(db, "tiers", tierId));
}

// 플레이 횟수 +1. 로그인하지 않은 사람도 셀 수 있어야 해서
// firestore.rules에서 "plays 필드만 바꾸는 업데이트"는 따로 허용해 둠.
export async function incrementTierPlay(tierId) {
  await updateDoc(doc(db, "tiers", tierId), { plays: increment(1) });
}

// 이 티어표를 고치거나 지울 수 있는 사람인지 (만든 사람 본인 또는 사이트 관리자)
export function canEditTier(tier, userEmail) {
  if (!tier || !userEmail) return false;
  return tier.creatorEmail === userEmail || isSiteOwner(userEmail);
}

export function timeAgo(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const seconds = Math.floor((Date.now() - timestamp.toDate().getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  return `${months}개월 전`;
}

// 업로드 날짜를 "2026-08-07 14:03" 같은 절대 날짜 형식으로 표시
export function formatDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  const d = timestamp.toDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

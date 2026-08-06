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
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
const provider = new GoogleAuthProvider();

// ---------- 이미지 업로드 (Firebase Storage) ----------
// file: <input type="file"> 에서 받은 File 객체, folder: "series-thumbnails" | "video-thumbnails"
export async function uploadThumbnail(file, folder) {
  if (!file) throw new Error("파일이 없습니다.");
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 업로드할 수 있습니다.");
  if (file.size > 5 * 1024 * 1024) throw new Error("이미지 크기는 5MB 이하여야 합니다.");
  const path = `${folder}/${Date.now()}_${file.name}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file);
  return await getDownloadURL(ref);
}

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

export async function getVideosForSeries(seriesId) {
  const q = query(
    collection(db, "series", seriesId, "videos"),
    orderBy("createdAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 홈 화면 "추천 비디오" - 전체 시리즈를 통틀어 최신 업로드 영상들
export async function getRecentVideosAcrossAllSeries(count = 8) {
  const q = query(
    collectionGroup(db, "videos"),
    orderBy("createdAt", "desc"),
    limit(count)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    seriesId: d.ref.parent.parent.id,
    ...d.data(),
  }));
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

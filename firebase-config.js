// Firebase 프로젝트(hyunilsearchingengine) 설정
export const firebaseConfig = {
  apiKey: "AIzaSyAVBiN1ezZ1B91-cEDnlSMaGoX36mcDltY",
  authDomain: "hyunilsearchingengine.firebaseapp.com",
  projectId: "hyunilsearchingengine",
  storageBucket: "hyunilsearchingengine.firebasestorage.app",
  messagingSenderId: "1009791769621",
  appId: "1:1009791769621:web:9b1b3d15c1397c028e821c",
};

// 사이트 관리자(=시리즈 생성 권한/업로드 권한을 다른 계정에게 부여할 수 있는 사람) 이메일 목록.
// ⚠️ 이 목록을 바꾸면 firestore.rules 안의 isAdmin() 이메일 목록도 반드시 똑같이 바꿔서
//    Firebase 콘솔 > Firestore Database > 규칙 탭에 다시 게시해야 합니다.
export const SITE_OWNER_EMAILS = [
  "ekcjs20100329@gmail.com",
];

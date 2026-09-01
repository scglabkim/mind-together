# Mind Together

링크 하나로 여러 사람이 함께 편집하는 로그인 없는 마인드맵 MVP입니다.

## 주요 기능

- 무작위 공유 링크로 보드 생성
- 아이디어 생성·수정·삭제·드래그
- 부모-자식 가지 연결
- 확대·축소·전체 보기
- 브라우저 자동 저장
- Firebase Realtime Database 실시간 공동편집
- 익명 인증과 접속자 수 표시
- 반응형 모바일 UI

## 로컬 실행

```bash
npm test
npm run serve
```

브라우저에서 `http://localhost:4173`을 엽니다.

Firebase 설정 전에는 브라우저의 Local Storage에 저장됩니다. 실시간 공동편집을 사용하려면 아래 설정을 완료합니다.

## Firebase 설정

1. Firebase 프로젝트를 만들고 Web App을 추가합니다.
2. Authentication에서 익명 로그인을 활성화합니다.
3. Realtime Database를 만들고 `database.rules.json`의 규칙을 적용합니다.
4. Firebase SDK 구성 객체를 `firebase-config.js`의 `window.MIND_TOGETHER_FIREBASE_CONFIG`에 입력합니다.

```js
window.MIND_TOGETHER_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "....firebaseapp.com",
  databaseURL: "https://....firebasedatabase.app",
  projectId: "...",
  storageBucket: "....firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

Firebase 웹 구성 객체는 클라이언트 식별 정보이며 비밀키가 아닙니다. 데이터 접근은 Realtime Database Security Rules와 Authentication으로 통제합니다.

## GitHub Pages

`.github/workflows/pages.yml`이 `main` 브랜치 변경 시 사이트를 배포합니다. 저장소의 **Settings → Pages → Source**를 **GitHub Actions**로 설정합니다.

## 데이터 구조

```text
rooms/{roomId}
  title
  nodes/{nodeId}
  presence/{anonymousUserId}
  updatedAt
```

루트의 전체 방 목록은 읽을 수 없고, 인증된 익명 사용자만 추측하기 어려운 Room ID를 가진 특정 경로에 접근할 수 있습니다.

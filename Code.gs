/**
 * 성모 게이밍 허브 — Google Apps Script 서버 코드
 *
 * 배포: 배포 > 새 배포 > 웹 앱
 *   - 다음 사용자 인증 정보로 실행: 나
 *   - 액세스 권한: smwelfare.or.kr 내 모든 사용자
 *     (같은 도메인 계정이어야 관리자 이메일을 확인할 수 있어요)
 *
 * 게임 목록은 스크립트 속성(PropertiesService)에 저장됩니다.
 * 관리자가 한 번도 저장하지 않았으면 index.html 의 DEFAULT_GAMES 가 쓰입니다.
 */

// 게임 링크를 수정할 수 있는 관리자 계정 (여러 명이면 쉼표로 추가)
var ADMIN_EMAILS = ['b3dler@smwelfare.or.kr'];

var GAMES_KEY = 'HUB_GAMES';
var CHUNK_SIZE = 2500; // 속성 값 1개당 약 9KB 제한 (한글은 글자당 3바이트) → 나눠서 저장

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('성모 게이밍 허브')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 허브가 처음 열릴 때 부르는 함수: 저장된 게임 목록 + 관리자 여부 */
function getHubData() {
  var email = currentEmail_();
  var admin = isAdmin_(email);
  return {
    games: loadGames_(),
    isAdmin: admin,
    email: admin ? email : ''
  };
}

/** 관리자만 호출 가능: 게임 목록 저장 */
function saveGames(games) {
  if (!isAdmin_(currentEmail_())) {
    throw new Error('관리자 계정만 저장할 수 있어요.');
  }
  if (!Array.isArray(games)) throw new Error('게임 목록 형식이 올바르지 않아요.');
  if (games.length > 100) throw new Error('게임은 100개까지 저장할 수 있어요.');

  var clean = games.map(cleanGame_);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    storeGames_(clean);
  } finally {
    lock.releaseLock();
  }
  return clean;
}

/* ---------------- 내부 함수 ---------------- */

function currentEmail_() {
  // 같은 도메인 사용자가 접속하면 이메일이 채워지고, 그 외에는 빈 문자열
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isAdmin_(email) {
  if (!email) return false;
  return ADMIN_EMAILS.some(function (a) { return a.toLowerCase() === email; });
}

function cleanGame_(g, i) {
  g = g || {};
  var hex = /^#[0-9a-fA-F]{6}$/;
  var colors = Array.isArray(g.colors) ? g.colors : [];
  var url = String(g.url || '').trim();
  if (url && !/^https:\/\//.test(url)) {
    throw new Error((g.title || (i + 1) + '번째 게임') + ': 주소는 https:// 로 시작해야 해요.');
  }
  return {
    id: String(g.id || ('game' + i)).slice(0, 40),
    title: String(g.title || '이름 없는 게임').slice(0, 40),
    emoji: String(g.emoji || '🎮').slice(0, 8),
    category: String(g.category || '기타').slice(0, 20),
    desc: String(g.desc || '').slice(0, 120),
    url: url.slice(0, 500),
    colors: [hex.test(colors[0]) ? colors[0] : '#9b5cff', hex.test(colors[1]) ? colors[1] : '#ff3ea5'],
    tag: g.tag === 'new' || g.tag === 'hot' ? g.tag : '',
    openMode: g.openMode === 'top' ? 'top' : 'hub'
  };
}

function loadGames_() {
  var props = PropertiesService.getScriptProperties();
  var count = Number(props.getProperty(GAMES_KEY + '_COUNT') || 0);
  if (!count) return [];
  var json = '';
  for (var i = 0; i < count; i++) json += props.getProperty(GAMES_KEY + '_' + i) || '';
  try {
    return JSON.parse(json);
  } catch (e) {
    return [];
  }
}

function storeGames_(games) {
  var props = PropertiesService.getScriptProperties();
  var json = JSON.stringify(games);
  var oldCount = Number(props.getProperty(GAMES_KEY + '_COUNT') || 0);
  var values = {};
  var count = 0;
  for (var i = 0; i < json.length; i += CHUNK_SIZE) {
    values[GAMES_KEY + '_' + count] = json.slice(i, i + CHUNK_SIZE);
    count++;
  }
  values[GAMES_KEY + '_COUNT'] = String(count);
  props.setProperties(values);
  for (var j = count; j < oldCount; j++) props.deleteProperty(GAMES_KEY + '_' + j);
}

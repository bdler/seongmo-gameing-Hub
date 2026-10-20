/**
 * 성모 게이밍 허브 — Google Apps Script 서버 코드
 *
 * 배포: 배포 > 새 배포 > 웹 앱
 *   - 다음 사용자 인증 정보로 실행: 나
 *   - 액세스 권한: 모든 사용자 (태블릿용 — 로그인 없이 열림)
 *
 * 관리자 화면 열기: 허브 오른쪽 위 ⚙️ 버튼을 누르고 관리자 비밀번호 입력
 *   - 비밀번호는 프로젝트 설정(⚙️) > 스크립트 속성 에 ADMIN_PASSWORD 로 넣어 두세요.
 *   - '모든 사용자' 배포에서는 구글이 접속 계정을 알려 주지 않아서 비밀번호로 확인합니다.
 *     (액세스가 smwelfare.or.kr 인 배포라면 ADMIN_EMAILS 계정은 비밀번호 없이 관리자)
 *
 * 게임 목록은 스크립트 속성(PropertiesService)에 저장됩니다.
 * 관리자가 한 번도 저장하지 않았으면 index.html 의 DEFAULT_GAMES 가 쓰입니다.
 */

// 게임 링크를 수정할 수 있는 관리자 계정 (여러 명이면 쉼표로 추가)
var ADMIN_EMAILS = ['b3dler@smwelfare.or.kr'];

var GAMES_KEY = 'HUB_GAMES';
var CHUNK_SIZE = 2500; // 속성 값 1개당 약 9KB 제한 (한글은 글자당 3바이트) → 나눠서 저장

var STATS_KEY = 'HUB_STATS';
var STATS_DAYS = 30; // 날짜별 접속 기록은 최근 30일만 보관

var MAX_PW_FAILS = 10; // 비밀번호를 10번 틀리면 10분 동안 잠금

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('성모 게이밍 허브')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 허브가 처음 열릴 때 부르는 함수: 저장된 게임 목록 + 관리자 여부 */
function getHubData(deviceId) {
  var email = currentEmail_();
  var admin = isAdmin_(email);
  // 계정을 알 수 없는 배포('모든 사용자')에서는 기기 id 로 접속자를 셈
  recordVisit_(email || (deviceId ? 'device:' + String(deviceId).slice(0, 40) : ''));
  return {
    games: loadGames_(),
    // 관리자가 마지막으로 저장할 때 알고 있던 기본 게임 id (새 기본 게임 자동 추가용)
    knownDefaults: loadKnownDefaults_(),
    isAdmin: admin,
    email: admin ? email : ''
  };
}

/** 관리자만 호출 가능: 게임 목록 저장 */
function saveGames(games, knownDefaults, password) {
  if (!isAuthorized_(password)) {
    throw new Error('관리자 계정만 저장할 수 있어요.');
  }
  if (!Array.isArray(games)) throw new Error('게임 목록 형식이 올바르지 않아요.');
  if (games.length > 100) throw new Error('게임은 100개까지 저장할 수 있어요.');

  var clean = games.map(cleanGame_);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    storeGames_(clean);
    if (Array.isArray(knownDefaults)) {
      var ids = knownDefaults.slice(0, 200).map(function (id) { return String(id).slice(0, 40); });
      PropertiesService.getScriptProperties().setProperty(GAMES_KEY + '_KNOWN_DEFAULTS', JSON.stringify(ids));
    }
  } finally {
    lock.releaseLock();
  }
  return clean;
}

/** 관리자 비밀번호 확인 (허브의 ⚙️ 버튼) */
function adminLogin(password) {
  return isAuthorized_(password);
}

/** 관리자만 호출 가능: 접속자 수 통계 */
function getStats(password) {
  if (!isAuthorized_(password)) {
    throw new Error('관리자 계정만 볼 수 있어요.');
  }
  var props = PropertiesService.getScriptProperties();
  var tz = Session.getScriptTimeZone();
  var days = [];
  for (var i = 0; i < 7; i++) {
    var date = Utilities.formatDate(new Date(Date.now() - i * 86400000), tz, 'yyyy-MM-dd');
    var day = loadDay_(props, date);
    days.push({ date: date, visits: day.v, users: day.u.length });
  }
  return {
    total: Number(props.getProperty(STATS_KEY + '_TOTAL') || 0),
    since: props.getProperty(STATS_KEY + '_SINCE') || '',
    days: days // 오늘부터 6일 전까지
  };
}

/* ---------------- 내부 함수 ---------------- */

/** 허브가 열릴 때마다 접속 1회 + 오늘의 접속자(계정 또는 기기 기준)를 기록 */
function recordVisit_(email) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return; // 기록이 밀려도 허브 열기는 막지 않음
  try {
    var props = PropertiesService.getScriptProperties();
    var tz = Session.getScriptTimeZone();
    var date = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    var day = loadDay_(props, date);
    day.v++;
    // 이메일 대신 짧은 해시만 저장 (속성 크기 제한 + 개인정보 최소화)
    var id = email ? hash_(email) : '';
    if (id && day.u.indexOf(id) < 0) day.u.push(id);

    var values = {};
    values[STATS_KEY + '_' + date] = JSON.stringify(day);
    values[STATS_KEY + '_TOTAL'] = String(Number(props.getProperty(STATS_KEY + '_TOTAL') || 0) + 1);
    if (!props.getProperty(STATS_KEY + '_SINCE')) values[STATS_KEY + '_SINCE'] = date;
    props.setProperties(values);

    if (day.v === 1) {
      // 하루의 첫 접속 때 오래된 날짜 기록 정리
      var oldest = Utilities.formatDate(new Date(Date.now() - STATS_DAYS * 86400000), tz, 'yyyy-MM-dd');
      var re = new RegExp('^' + STATS_KEY + '_(\\d{4}-\\d{2}-\\d{2})$');
      props.getKeys().forEach(function (k) {
        var m = re.exec(k);
        if (m && m[1] < oldest) props.deleteProperty(k);
      });
    }
  } catch (e) {
    // 통계 기록 실패는 무시
  } finally {
    lock.releaseLock();
  }
}

function loadDay_(props, date) {
  try {
    var d = JSON.parse(props.getProperty(STATS_KEY + '_' + date) || 'null');
    if (d && typeof d.v === 'number' && Array.isArray(d.u)) return d;
  } catch (e) {}
  return { v: 0, u: [] };
}

function hash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return Utilities.base64EncodeWebSafe(bytes).slice(0, 8);
}


function currentEmail_() {
  // 같은 도메인 사용자가 접속하면 이메일이 채워지고, 그 외에는 빈 문자열
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

/** 관리자 계정이거나 관리자 비밀번호가 맞으면 true */
function isAuthorized_(password) {
  if (isAdmin_(currentEmail_())) return true;
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real || !password) return false;
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('ADMIN_PW_FAILS') || 0);
  if (fails >= MAX_PW_FAILS) throw new Error('비밀번호를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요.');
  if (String(password) === real) return true;
  cache.put('ADMIN_PW_FAILS', String(fails + 1), 600);
  return false;
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

function loadKnownDefaults_() {
  var v = PropertiesService.getScriptProperties().getProperty(GAMES_KEY + '_KNOWN_DEFAULTS');
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch (e) {
    return null;
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

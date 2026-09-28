/**
 * 성모 게이밍 허브 — Google Apps Script 서버 코드
 *
 * 배포: 배포 > 새 배포 > 웹 앱 (실행: 나 / 액세스: 모든 사용자)
 * 게임 목록: 지금은 index.html 의 DEFAULT_GAMES 를 사용하고,
 *           아래 getGames() 가 빈 배열이 아니면 그 목록으로 교체됩니다.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('성모 게이밍 허브')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 게임 목록을 반환합니다.
 * 나중에 구글 시트('Games' 시트)로 관리하려면 아래 주석을 해제하세요.
 * 시트 열 순서: id | title | emoji | category | desc | url | color1 | color2 | tag | rating | soon
 */
function getGames() {
  // var sheet = SpreadsheetApp.getActive().getSheetByName('Games');
  // if (!sheet) return [];
  // var rows = sheet.getDataRange().getValues().slice(1);
  // return rows.filter(function (r) { return r[0]; }).map(function (r) {
  //   return {
  //     id: String(r[0]), title: r[1], emoji: r[2], category: r[3], desc: r[4],
  //     url: r[5], colors: [r[6] || '#9b5cff', r[7] || '#ff3ea5'],
  //     tag: r[8], rating: Number(r[9]) || 4, soon: r[10] === true
  //   };
  // });
  return [];
}

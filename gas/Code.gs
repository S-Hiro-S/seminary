/**
 * 神学校ポータルサイト スプレッドシート自動書き出し・送信スクリプト (GAS)
 * 
 * [概要]
 * スプレッドシート内の全シート（または指定シート）のデータをJSON化し、
 * ポータルサイトサーバーの api/update_data.php へ POST 送信します。
 */

// 送信対象とするシート名のリスト（空配列 [] の場合はすべての非非表示シートが対象）
const TARGET_SHEETS = ['classes', 'vacations', 'intensive', 'notices'];

/**
 * 初期設定用関数（手動で一度だけ実行してください）
 */
function setup() {
  const scriptProperties = PropertiesService.getScriptProperties();
  
  // ★実際のサーバーURLに書き換えてください
  scriptProperties.setProperty('API_URL', 'https://your-domain.com/api/update_data.php');
  
  // ★api/update_data.php で設定した API_KEY と同じ文字列を設定してください
  scriptProperties.setProperty('API_KEY', 'seminary_portal_secret_key_2026');
  
  // トリガーを自動設定
  createTriggers();
  
  Logger.log('初期設定が完了しました。API_URL と API_KEY を確認し、必要に応じて変更してください。');
}

/**
 * トリガーを自動生成
 */
function createTriggers() {
  // 既存の同一トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const fnName = triggers[i].getHandlerFunction();
    if (fnName === 'onSpreadsheetChange' || fnName === 'syncAllData') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 1. スプレッドシート変更時トリガー (リアルタイム更新)
  ScriptApp.newTrigger('onSpreadsheetChange')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onChange()
    .create();

  // 2. 定期バックアップトリガー (1時間ごと)
  ScriptApp.newTrigger('syncAllData')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('onChange トリガーと定期トリガーを設置しました。');
}

/**
 * スプレッドシート変更時のイベントハンドラ (リアルタイム)
 */
function onSpreadsheetChange(e) {
  Logger.log('スプレッドシートの変更を検知しました。送信処理を実行します...');
  syncAllData();
}

/**
 * 手動実行 / 定期トリガー用：全対象シートの同期
 */
function syncAllData() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL');
  const apiKey = props.getProperty('API_KEY');

  if (!apiUrl || !apiKey) {
    Logger.log('エラー: API_URL または API_KEY が設定されていません。setup() を実行してください。');
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const exportData = {};

  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    // 非表示シートを除外＆対象シートのみ抽出
    if (!sheet.isSheetHidden()) {
      if (TARGET_SHEETS.length === 0 || TARGET_SHEETS.includes(sheetName)) {
        exportData[sheetName] = parseSheetToObjects(sheet);
      }
    }
  });

  // サーバーへ POST 送信
  const payload = JSON.stringify({
    api_key: apiKey,
    data: exportData,
    timestamp: new Date().toISOString()
  });

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-KEY': apiKey
    },
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const code = response.getResponseCode();
    const content = response.getContentText();

    if (code === 200) {
      Logger.log('送信成功: ' + content);
    } else {
      Logger.log('送信失敗 (HTTP ' + code + '): ' + content);
    }
  } catch (err) {
    Logger.log('通信エラー: ' + err.toString());
  }
}

/**
 * 1つのシートをJSONオブジェクト配列に変換するユーティリティ
 */
function parseSheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return []; // ヘッダーのみまたは空の場合

  const headers = data[0].map(h => String(h).trim());
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // 全セルが空の行はスキップ
    if (row.every(cell => cell === '' || cell === null)) continue;

    const rowObj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      let val = row[index];
      
      // 日付オブジェクトの場合は ISO8601 文字列に変換
      if (val instanceof Date) {
        val = val.toISOString();
      }
      rowObj[header] = val;
    });

    result.push(rowObj);
  }

  return result;
}

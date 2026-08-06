<?php
/**
 * スプレッドシートデータ更新受信用 API
 * Google Apps Script (GAS) からの POST リクエストを受け取り、data/*.json に書き出します。
 */

// セキュリティ設定: APIキー（GAS側と統一してください）
define('API_KEY', 'seminary_portal_secret_key_2026');

// レスポンスヘッダー（JSON）
header('Content-Type: application/json; charset=UTF-8');

// POSTリクエストのみ許可
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method Not Allowed']);
    exit;
}

// リクエストデータの取得（JSONまたはPOSTデータ）
$rawInput = file_get_contents('php://input');
$inputData = json_decode($rawInput, true);

if (!$inputData && !empty($_POST)) {
    $inputData = $_POST;
}

// APIキー検証 (X-API-KEY ヘッダー または POSTボディ内の api_key)
$providedKey = $_SERVER['HTTP_X_API_KEY'] ?? ($inputData['api_key'] ?? '');

if (empty(API_KEY) || $providedKey !== API_KEY) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized: Invalid API Key']);
    exit;
}

// 保存先ディレクトリ
$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) {
    if (!mkdir($dataDir, 0755, true)) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Failed to create data directory']);
        exit;
    }
}

$updatedSheets = [];

// ケース1: 複数シート一括送信 { "data": { "classes": [...], "vacations": [...] } }
if (isset($inputData['data']) && is_array($inputData['data']) && !isset($inputData['sheet'])) {
    foreach ($inputData['data'] as $sheetName => $sheetContent) {
        $cleanName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $sheetName);
        if (empty($cleanName)) continue;

        $filePath = $dataDir . '/' . $cleanName . '.json';
        $jsonString = json_encode($sheetContent, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        
        if (file_put_contents($filePath, $jsonString) !== false) {
            $updatedSheets[] = $cleanName;
        }
    }
}
// ケース2: 単一シート送信 { "sheet": "classes", "data": [...] }
elseif (isset($inputData['sheet']) && isset($inputData['data'])) {
    $cleanName = preg_replace('/[^a-zA-Z0-9_\-]/', '', $inputData['sheet']);
    if (!empty($cleanName)) {
        $filePath = $dataDir . '/' . $cleanName . '.json';
        $jsonString = json_encode($inputData['data'], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        
        if (file_put_contents($filePath, $jsonString) !== false) {
            $updatedSheets[] = $cleanName;
        }
    }
}

if (count($updatedSheets) > 0) {
    echo json_encode([
        'status' => 'success',
        'message' => 'Data updated successfully',
        'updated' => $updatedSheets,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
} else {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'No valid sheet data processed']);
}

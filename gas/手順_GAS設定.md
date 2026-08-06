# スプレッドシートデータ高速化（静的JSONリアルタイム配信）導入手順

Google Apps Script (GAS) からサーバー上の PHP API (`api/update_data.php`) にデータを自動送信し、静的 JSON ファイルとして高速配信するための設定手順です。

---

## 1. サーバー側の準備

1. 今回作成した [`api/update_data.php`](file:///j:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/%E6%95%99%E5%9B%A3%E9%96%A2%E4%BF%82/%E7%A5%9E%E5%AD%A6%E6%A0%A1/%E7%A5%9E%E5%AD%A6%E6%A0%A1%E3%83%9D%E3%83%BC%E3%82%BF%E3%83%AB%E9%96%A2%E4%BF%82/api/update_data.php) をサーバーの `api/` ディレクトリにアップロードします。
2. `api/update_data.php` 内の冒頭にある `API_KEY` を必要に応じて任意のシークレット文字列に変更します。
   ```php
   define('API_KEY', 'seminary_portal_secret_key_2026'); // 任意の英数字
   ```
3. サーバー上に `data/` ディレクトリが自動作成され、書き込み権限（パーミッション `0755` または `0777`）が与えられていることを確認します。

---

## 2. Google Apps Script (GAS) 側の設定

1. 対象の Google スプレッドシートを開きます。
2. メニューバーの **[拡張機能] ＞ [Apps Script]** をクリックします。
3. コードエディタが開いたら、既存のコードを消去し、[`gas/Code.gs`](file:///j:/%E3%83%9E%E3%82%A4%E3%83%89%E3%83%A9%E3%82%A4%E3%83%96/%E6%95%99%E5%9B%A3%E9%96%A2%E4%BF%82/%E7%A5%9E%E5%AD%A6%E6%A0%A1/%E7%A5%9E%E5%AD%A6%E6%A0%A1%E3%83%9D%E3%83%BC%E3%82%BF%E3%83%AB%E9%96%A2%E4%BF%82/gas/Code.gs) の内容を貼り付けます。
4. `setup()` 関数内の設定項目を変更します:
   ```javascript
   // ご自身のサーバーのURLに置き換えてください
   scriptProperties.setProperty('API_URL', 'https://your-domain.com/api/update_data.php');
   
   // update_data.php で設定した API_KEY と同じ文字列を設定してください
   scriptProperties.setProperty('API_KEY', 'seminary_portal_secret_key_2026');
   ```
5. エディタ上部の関数選択ドロップダウンで **`setup`** を選択し、**[実行]** ボタンを押します。
6. 初回実行時、「承認が必要です」というダイアログが表示されるため、指示に従って外部送信権限を承認します。
7. 「実行ログ」に `onChange トリガーと定期トリガーを設置しました。` と表示されれば設定完了です。

---

## 3. 動作確認

1. **手動同期テスト**:
   - GASエディタで `syncAllData` 関数を選択し、[実行] を押します。
   - サーバーの `data/` ディレクトリ内に `classes.json`, `vacations.json`, `intensive.json`, `notices.json` などが書き出されていることを確認します。
2. **リアルタイム同期テスト**:
   - スプレッドシートの任意のセルを編集します。
   - `onChange` トリガーにより自動的に `syncAllData` が裏で起動し、数秒〜十数秒以内にサーバー上の JSON ファイルが更新されます。
3. **フロントエンド表示テスト**:
   - ポータルサイト (`index.html`) をブラウザで開きます。
   - GASへの動的アクセス（遅延）が無くなり、`./data/*.json` から一瞬（数十ミリ秒）でデータが読み込まれることを確認します。

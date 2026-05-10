# 台新證券自動下單 — Railway 環境變數設定

## 必填變數

| 變數名稱 | 說明 | 範例 |
|---|---|---|
| `TAISHIN_PERSONAL_ID` | 身分證字號（登入帳號） | `A123456789` |
| `TAISHIN_PASSWORD` | 台新證券登入密碼 | |
| `TAISHIN_CERT` | `.pfx` 憑證的 base64 字串 | 見下方說明 |
| `TAISHIN_CERT_PASS` | 憑證密碼 | |
| `TAISHIN_PAPER` | `1` = 模擬模式（不真實下單）<br>`0` = 真實交易 | `1` |

## 憑證轉換（TAISHIN_CERT）

將 `.pfx` 憑證轉成 base64 後貼到 Railway：

**Mac / Linux：**
```bash
base64 -i 你的憑證.pfx | tr -d '\n'
```

**Windows（PowerShell）：**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\憑證.pfx"))
```

輸出的單行字串貼到 `TAISHIN_CERT` 欄位。

## 測試步驟

1. Railway 先設 `TAISHIN_PAPER=1`（模擬模式）
2. 部署後，請小B執行 `get_balance` 或 `get_orders` 確認連線正常
3. 試下一筆模擬單：買 1 張台積電，確認回傳 `paper: true`
4. 確認無誤後，將 `TAISHIN_PAPER` 改為 `0` 再重新部署

## 可用工具（小B 可執行的指令）

| 工具 | 說明 |
|---|---|
| `place_order` | 下單，單筆上限 5000 股，執行前會向你確認 |
| `cancel_order` | 取消委託（需先 get_orders 取得 orderNo + workDate） |
| `get_orders` | 查詢今日委託清單 |
| `get_inventories` | 查詢目前持股 |
| `get_balance` | 查詢可用資金 |
| `get_transactions` | 查詢成交明細（近 1m / 3m / 6m） |
| `get_settlements` | 查詢待交割款項 |

## 注意事項

- 台新 SDK (`taishin-sdk`) 需從台新私有 npm registry 安裝，若 Railway build 失敗請確認 registry 設定
- `cancelOrder` 需要 `orderNo` 和 `workDate` 兩個欄位（從 `get_orders` 或 `place_order` 回傳取得）
- 富果行情查詢（`FUGLE_API_KEY`）是獨立功能，與此交易模組無關聯

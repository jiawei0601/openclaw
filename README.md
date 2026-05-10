# 小A — 台股自動交易機器人

基於 [OpenClaw](https://openclaw.ai) 平台，透過 Telegram 操作台股行情查詢與台新證券自動下單。

## 功能

| 工具 | 說明 |
|---|---|
| `get_stock_quote` | 查詢即時股價（富果行情） |
| `get_stock_candles` | 查詢歷史日K線 |
| `place_order` | 下單（限價/市價），執行前必須確認 |
| `cancel_order` | 取消委託 |
| `get_orders` | 查詢今日委託清單 |
| `get_inventories` | 查詢持股庫存 |
| `get_balance` | 查詢可用資金 |
| `get_transactions` | 查詢成交明細（近 1/3/6 個月） |
| `get_settlements` | 查詢待交割款項 |

## Railway 部署環境變數

### Telegram（必填）

| 變數 | 說明 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather 產生的 bot token |

### AI 模型（必填，擇一）

| 變數 | 說明 |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API Key（預設使用 Gemini） |

### 富果行情（選填）

| 變數 | 說明 |
|---|---|
| `FUGLE_API_KEY` | 富果行情 API Key（提供即時股價與K線查詢） |

### 台新證券下單（選填）

| 變數 | 說明 |
|---|---|
| `TAISHIN_PERSONAL_ID` | 身分證字號（台新帳號） |
| `TAISHIN_PASSWORD` | 台新證券登入密碼 |
| `TAISHIN_CERT` | `.pfx` 憑證轉 base64 的單行字串（見下方說明） |
| `TAISHIN_CERT_PASS` | 憑證密碼 |
| `TAISHIN_PAPER` | `1` = 模擬模式（預設）／`0` = 真實交易 |

### 選填設定

| 變數 | 說明 | 預設值 |
|---|---|---|
| `AGENT_MODEL` | AI 模型 ID | `google/gemini-2.5-flash-preview` |
| `AGENT_SYSTEM_PROMPT` | 覆寫系統提示詞 | 內建小A提示詞 |

## 憑證轉換（TAISHIN_CERT）

**Windows PowerShell：**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\憑證.pfx"))
```

**Mac / Linux：**
```bash
base64 -i 憑證.pfx | tr -d '\n'
```

輸出的單行字串貼到 Railway 的 `TAISHIN_CERT` 欄位。

## 測試步驟

1. Railway 先設 `TAISHIN_PAPER=1`（模擬模式）
2. 部署後，透過 Telegram 對小A說：「查詢我的帳戶餘額」
3. 確認連線正常後，試下模擬單
4. 無誤後將 `TAISHIN_PAPER` 改為 `0` 重新部署，啟用真實交易

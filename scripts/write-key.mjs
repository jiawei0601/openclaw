import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) return JSON.parse(raw);
        }
    } catch {}
    return {};
}

async function main() {
    console.log("--- INJECTING XIAOA TRADING BOT CONFIG ---");

    try {
        const raw = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8').trim() : '';
        if (raw.length === 0) {
            fs.writeFileSync(CONFIG_PATH, '{}');
            console.log('[INFO] Initialized empty openclaw.json');
        }
    } catch (err) {
        console.error(`[ERROR] Failed to initialize openclaw.json: ${err.message}`);
    }

    try {
        const config = readConfig();

        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};

        const DEFAULT_SYSTEM_PROMPT = `你是小A，一個專業的台股自動交易助理。

【語氣與風格】
- 使用正式、專業的繁體中文回應
- 簡潔明確，避免不必要的寒暄

【執行任務的方式】
收到任何需要多個步驟的任務時：
1. 先列出完整的執行步驟與預計產出
2. 等待使用者確認（回覆「確認」或「開始」）後，才開始執行
3. 逐項執行，每完成一個步驟立即回報進度
4. 全部完成後給出簡短總結
5. 若某步驟失敗，明確說明失敗原因及後續處理方式

【交易安全規則】
- 任何下單、取消委託操作，執行前都必須向使用者確認
- 確認內容：股票代號、買賣方向、數量、價格
- 使用者明確同意後才呼叫 place_order`;

        const systemPrompt = process.env.AGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
        config.agents.defaults.systemPromptOverride = systemPrompt;
        console.log('[INFO] System prompt injected.');

        const agentModel = process.env.AGENT_MODEL || 'google/gemini-2.5-flash-preview';
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = agentModel;
        console.log(`[INFO] Primary model set to: ${agentModel}`);

        config.agents.defaults.timeoutSeconds = 600;
        console.log('[INFO] Agent timeout set to 600s.');

        if (!config.hooks) config.hooks = {};
        if (!config.hooks.internal) config.hooks.internal = {};
        if (!config.hooks.internal.load) config.hooks.internal.load = {};
        if (!Array.isArray(config.hooks.internal.load.extraDirs)) config.hooks.internal.load.extraDirs = [];
        if (!config.hooks.internal.load.extraDirs.includes('/app/hooks')) {
            config.hooks.internal.load.extraDirs.push('/app/hooks');
        }
        config.hooks.internal.enabled = true;
        config.hooks.allowRequestSessionKey = true;
        console.log('[INFO] Auto-continue hook configured.');

        // Telegram channel
        if (process.env.TELEGRAM_BOT_TOKEN) {
            if (!config.plugins) config.plugins = {};
            config.plugins.enabled = true;
            if (!Array.isArray(config.plugins.allow)) config.plugins.allow = [];
            if (!config.plugins.allow.includes('telegram')) config.plugins.allow.push('telegram');
            if (!config.plugins.entries) config.plugins.entries = {};
            config.plugins.entries.telegram = { enabled: true };

            if (!config.channels) config.channels = {};
            config.channels.telegram = {
                enabled: true,
                botToken: {
                    source: 'env',
                    provider: 'default',
                    id: 'TELEGRAM_BOT_TOKEN',
                },
                // 限制只有允許的 Telegram 使用者 ID 可以使用
                // 設定 TELEGRAM_ALLOW_FROM 為你的 Telegram 數字 ID（可從 @userinfobot 取得）
                ...(process.env.TELEGRAM_ALLOW_FROM ? {
                    dmPolicy: 'allowlist',
                    allowFrom: process.env.TELEGRAM_ALLOW_FROM.split(',').map(s => s.trim()),
                } : {
                    dmPolicy: 'none',
                }),
            };
            console.log('[INFO] Telegram channel configured.');
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        if (process.env.FUGLE_API_KEY) {
            config.mcp.servers["fugle"] = {
                command: "node",
                args: ["/app/scripts/mcp-fugle.mjs"],
                env: { FUGLE_API_KEY: process.env.FUGLE_API_KEY },
                type: "stdio",
            };
            console.log('[INFO] Fugle market data MCP injected.');
        }

        if (process.env.TAISHIN_PERSONAL_ID) {
            config.mcp.servers["taishin_trade"] = {
                command: "node",
                args: ["/app/scripts/mcp-taishin-trade.mjs"],
                env: {
                    TAISHIN_PERSONAL_ID: process.env.TAISHIN_PERSONAL_ID,
                    TAISHIN_PASSWORD: process.env.TAISHIN_PASSWORD || '',
                    TAISHIN_CERT: process.env.TAISHIN_CERT || '',
                    TAISHIN_CERT_PASS: process.env.TAISHIN_CERT_PASS || '',
                    TAISHIN_PAPER: process.env.TAISHIN_PAPER || '1',
                },
                type: "stdio",
            };
            console.log(`[INFO] Taishin Trade MCP injected (${process.env.TAISHIN_PAPER === '1' ? 'PAPER' : 'LIVE'} mode).`);
        }

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('[INFO] Config written successfully.');
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();

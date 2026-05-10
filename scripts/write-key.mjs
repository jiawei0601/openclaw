import fs from 'fs';
import { parseCredentials } from './lib/parse-credentials.mjs';

const CONFIG_PATH = '/app/openclaw.json';
const KEY_PATH = '/tmp/google-drive-key.json';

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
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    // Ensure openclaw.json is valid — the Dockerfile does not copy it into the
    // final runtime image so the file starts empty, which causes a JSON parse crash.
    try {
        const raw = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8').trim() : '';
        if (raw.length === 0) {
            fs.writeFileSync(CONFIG_PATH, '{}');
            console.log('[INFO] Initialized empty openclaw.json');
        }
    } catch (err) {
        console.error(`[ERROR] Failed to initialize openclaw.json: ${err.message}`);
    }

    const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
    const useOAuth = oauthClientId && oauthClientSecret && oauthRefreshToken;

    const mcpEnv = {};
    if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
        mcpEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    }

    let driveAvailable = false;

    if (useOAuth) {
        console.log('[INFO] Auth mode: OAuth user credentials detected.');
        mcpEnv.GOOGLE_OAUTH_CLIENT_ID = oauthClientId;
        mcpEnv.GOOGLE_OAUTH_CLIENT_SECRET = oauthClientSecret;
        mcpEnv.GOOGLE_OAUTH_REFRESH_TOKEN = oauthRefreshToken;
        driveAvailable = true;
    } else {
        const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
        if (!rawCredentials) {
            console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON or OAuth variables found. Google Drive tools will not be available.");
        } else {
            console.log(`[INFO] GOOGLE_DRIVE_CREDENTIALS_JSON raw length: ${rawCredentials.length}`);
            console.log(`[INFO] First 40 chars: ${JSON.stringify(rawCredentials.slice(0, 40))}`);

            let credentials;
            try {
                credentials = parseCredentials(rawCredentials);
            } catch (err) {
                console.error(`[ERROR] ${err.message}`);
                console.error('[ERROR] Google Drive MCP will not be available. Fix GOOGLE_DRIVE_CREDENTIALS_JSON in Railway variables.');
                credentials = null;
            }

            if (credentials) {
                const keys = Object.keys(credentials);
                console.log(`[INFO] Parsed credential keys: ${keys.join(', ')}`);
                console.log(`[INFO] client_email: ${credentials.client_email || '(missing)'}`);
                console.log(`[INFO] private_key: ${credentials.private_key
                    ? `present (${credentials.private_key.length} chars, starts: ${credentials.private_key.slice(0, 27)}...)`
                    : '(missing or empty)'}`);

                if (!credentials.private_key || !credentials.client_email) {
                    console.error('[ERROR] Parsed credentials missing private_key or client_email. Google Drive MCP will not be available.');
                } else {
                    try {
                        fs.writeFileSync(KEY_PATH, JSON.stringify(credentials), 'utf8');
                        console.log(`[INFO] Credentials written to ${KEY_PATH}`);
                        mcpEnv.GOOGLE_DRIVE_KEY_PATH = KEY_PATH;
                        driveAvailable = true;
                    } catch (err) {
                        console.error(`[ERROR] Failed to write credentials file: ${err.message}`);
                    }
                }
            }
        }
    }

    try {
        const config = readConfig();

        // Inject agent defaults
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};

        const DEFAULT_SYSTEM_PROMPT = `你是小B，一個專業、高效率的個人AI助理。

【語氣與風格】
- 使用正式、專業的繁體中文回應
- 簡潔明確，避免不必要的寒暄

【執行任務的方式】
收到任何需要多個步驟的任務時：
1. 先列出完整的執行步驟與預計產出
2. 等待使用者確認（回覆「確認」或「開始」）後，才開始執行
3. 逐項執行，每完成一個步驟立即回報進度（例如：「步驟 2/4 完成：已建立試算表」）
4. 全部完成後給出簡短總結
5. 若某步驟失敗，明確說明失敗原因及後續處理方式

【Google Drive 使用規則】
- 除非使用者明確要求（例如：「存到雲端硬碟」、「建立一份文件」），否則直接在對話中回答
- 不主動將內容寫入 Drive`;

        const systemPrompt = process.env.AGENT_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
        config.agents.defaults.systemPromptOverride = systemPrompt;
        console.log('[INFO] System prompt injected.');

        // Set primary model
        const agentModel = process.env.AGENT_MODEL || 'google/gemini-3.1-flash-lite-preview';
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = agentModel;
        console.log(`[INFO] Primary model set to: ${agentModel}`);

        // Extend agent turn timeout for complex multi-step tasks
        config.agents.defaults.timeoutSeconds = 600;
        console.log('[INFO] Agent timeout set to 600s.');

        // Enable auto-continue hook
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

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        if (driveAvailable) {
            config.mcp.servers["google_drive"] = {
                command: "node",
                args: ["/app/scripts/mcp-gdrive.mjs"],
                env: mcpEnv,
                type: "stdio",
            };
            console.log(`[INFO] Google Drive MCP injected. Root folder: ${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '(unrestricted)'}`);
        }

        if (process.env.FUGLE_API_KEY) {
            config.mcp.servers["fugle"] = {
                command: "node",
                args: ["/app/scripts/mcp-fugle.mjs"],
                env: { FUGLE_API_KEY: process.env.FUGLE_API_KEY },
                type: "stdio",
            };
            console.log('[INFO] Fugle MCP injected.');
        }

        config.mcp.servers["scheduler"] = {
            command: "node",
            args: ["/app/scripts/mcp-scheduler.mjs"],
            env: {},
            type: "stdio",
        };
        console.log('[INFO] Scheduler MCP injected.');

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();
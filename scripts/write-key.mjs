import fs from 'fs';
import path from 'path';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    // 1. Write the Google Drive Key
    const credentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (credentials) {
        try {
            fs.writeFileSync(KEY_PATH, credentials);
            console.log(`[INFO] Google Drive key written to ${KEY_PATH}`);
        } catch (err) {
            console.error(`[ERROR] Failed to write key: ${err.message}`);
        }
    }

    // 2. Inject into openclaw.json
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) {
                try {
                    config = JSON.parse(raw);
                } catch (parseErr) {
                    console.warn(`[WARN] Existing config is invalid JSON, starting fresh: ${parseErr.message}`);
                    config = {};
                }
            }
        }

        // Correct nesting based on src/agents/bundle-mcp-config.ts
        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        // Inject Google Drive Tool
        config.mcp.servers["google_drive"] = {
            command: "/usr/local/bin/mcp-server-gdrive",
            args: ["--service-account-key", KEY_PATH],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                NODE_ENV: "production"
            },
            type: "stdio",
            description: "Access and manage files in Google Drive, including reading, creating, and editing documents."
        };

        // Write back as formatted JSON
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Google Drive tool successfully injected into ${CONFIG_PATH} (mcp.servers)`);

    } catch (err) {
        console.error(`[ERROR] Configuration injection failed: ${err.message}`);
        if (!fs.existsSync(CONFIG_PATH) || fs.readFileSync(CONFIG_PATH).length === 0) {
            fs.writeFileSync(CONFIG_PATH, '{}');
        }
    }
}

main();

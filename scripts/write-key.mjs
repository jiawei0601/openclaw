import fs from 'fs';
import path from 'path';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- INJECTING CUSTOM STABLE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No Google Drive credentials found in environment.");
        return;
    }

    try {
        fs.writeFileSync(KEY_PATH, rawCredentials);
    } catch (err) {
        console.error(`[ERROR] Write failed: ${err.message}`);
    }

    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};
        config.mcp.servers["google_drive"] = {
            command: "node", 
            args: ["scripts/mcp-gdrive.mjs"], 
            env: {
                GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: rawCredentials
            },
            type: "stdio"
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Custom stable MCP injected successfully.`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();

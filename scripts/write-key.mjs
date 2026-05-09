import fs from 'fs';
import { spawnSync } from 'child_process';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- FINAL ATTEMPT DIAGNOSTICS ---");

    // 1. Write the Key
    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) return;

    try {
        fs.writeFileSync(KEY_PATH, rawCredentials);
        console.log(`[INFO] Key written to ${KEY_PATH}`);
    } catch (err) {
        console.error(`[ERROR] Write failed: ${err.message}`);
    }

    // 2. Updated Injection Strategy
    // We will use BOTH environment variables and arguments to force Service Account mode
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        config.mcp.servers["google_drive"] = {
            // Force using node to run the global binary if possible, or just the binary
            command: "mcp-server-gdrive", 
            args: ["--service-account-key", KEY_PATH],
            env: {
                // This is the CRITICAL one for Google Cloud SDK
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                // Some servers need this to skip the 'auth' prompt
                GDRIVE_SERVICE_ACCOUNT: "true" 
            },
            type: "stdio"
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Final configuration injected with GOOGLE_APPLICATION_CREDENTIALS force.`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();

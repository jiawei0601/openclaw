import fs from 'fs';

const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- INJECTING GOOGLE WORKSPACE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.log("[SKIP] No GOOGLE_DRIVE_CREDENTIALS_JSON found. Google Drive tools will not be available.");
        return;
    }

    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        const mcpEnv = {
            GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: rawCredentials,
        };
        if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
            mcpEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        }

        config.mcp.servers["google_drive"] = {
            command: "node",
            args: ["/app/scripts/mcp-gdrive.mjs"],
            env: mcpEnv,
            type: "stdio",
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] MCP injected. Root folder: ${process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '(unrestricted — set GOOGLE_DRIVE_ROOT_FOLDER_ID to restrict)'}`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
        process.exit(1);
    }
}

main();

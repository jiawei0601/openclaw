import fs from 'fs';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- ATTEMPTING COMMUNITY GOOGLE DRIVE MCP ---");

    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) return;

    try {
        fs.writeFileSync(KEY_PATH, rawCredentials);
        console.log(`[INFO] Key written to ${KEY_PATH}`);
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

        // Use a known existing community package on npm
        config.mcp.servers["google_drive"] = {
            command: "npx", 
            args: ["-y", "@piotr-agier/google-drive-mcp"],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: rawCredentials
            },
            type: "stdio"
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Configuration updated with community MCP server.`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();

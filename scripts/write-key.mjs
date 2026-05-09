import fs from 'fs';
import { spawnSync } from 'child_process';

const KEY_PATH = '/tmp/google-drive-key.json';
const CONFIG_PATH = '/app/openclaw.json';

async function main() {
    console.log("--- STARTING DEEP DIAGNOSTICS ---");

    // 1. Verify and Write Google Drive Key
    const rawCredentials = process.env.GOOGLE_DRIVE_CREDENTIALS_JSON;
    if (!rawCredentials) {
        console.error("[ERROR] GOOGLE_DRIVE_CREDENTIALS_JSON is MISSING!");
        return;
    }

    try {
        // Try to parse to ensure it's valid JSON
        const parsed = JSON.parse(rawCredentials);
        console.log(`[INFO] Credentials JSON is valid. Type: ${parsed.type}, Project: ${parsed.project_id}`);
        
        // Write to file
        fs.writeFileSync(KEY_PATH, rawCredentials);
        console.log(`[INFO] Key written to ${KEY_PATH}`);
    } catch (err) {
        console.error(`[ERROR] Credentials JSON is INVALID: ${err.message}`);
        console.log(`[DEBUG] Raw start: ${rawCredentials.substring(0, 50)}...`);
    }

    // 2. TEST RUN the MCP Server to see WHY it crashes
    console.log("[INFO] Attempting to dry-run the MCP server...");
    const testRun = spawnSync('/usr/local/bin/mcp-server-gdrive', ['--service-account-key', KEY_PATH], {
        env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH },
        timeout: 5000,
        encoding: 'utf8'
    });

    // Note: MCP servers expect to run indefinitely, so spawnSync might timeout or fail.
    // But we can see the initial output.
    if (testRun.stderr) {
        console.log("--- MCP SERVER STDERR (CRITICAL) ---");
        console.log(testRun.stderr);
    }
    if (testRun.stdout) {
        console.log("--- MCP SERVER STDOUT ---");
        console.log(testRun.stdout);
    }

    // 3. Inject into openclaw.json (Correcting Path)
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
            if (raw.length > 0) config = JSON.parse(raw);
        }

        if (!config.mcp) config.mcp = {};
        if (!config.mcp.servers) config.mcp.servers = {};

        config.mcp.servers["google_drive"] = {
            command: "/usr/local/bin/mcp-server-gdrive",
            args: ["--service-account-key", KEY_PATH],
            env: {
                GOOGLE_APPLICATION_CREDENTIALS: KEY_PATH,
                NODE_ENV: "production"
            },
            type: "stdio",
            description: "Access and manage files in Google Drive."
        };

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`[INFO] Injection successful.`);
    } catch (err) {
        console.error(`[ERROR] Config injection failed: ${err.message}`);
    }
}

main();

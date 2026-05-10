import fs from 'fs';

const SCHEDULES_FILE = process.env.SCHEDULES_FILE || '/tmp/schedules.json';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL = process.env.AGENT_MODEL?.replace('google/', '') || 'gemini-2.5-flash-preview';

// ── Startup checks ──────────────────────────────────────────────────────────
if (!GEMINI_API_KEY) {
    console.error('[Daemon] GEMINI_API_KEY not set, exiting.');
    process.exit(1);
}
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('[Daemon] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, exiting.');
    process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadSchedules() {
    try {
        if (fs.existsSync(SCHEDULES_FILE)) {
            return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
        }
    } catch {}
    return {};
}

function saveSchedules(schedules) {
    try {
        fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
    } catch (err) {
        console.error('[Daemon] Failed to save schedules:', err.message);
    }
}

function getTaiwanTime() {
    const tw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    return {
        hour: tw.getHours(),
        minute: tw.getMinutes(),
        day: tw.getDay(), // 0=Sun … 6=Sat
    };
}

function shouldFire(schedule, lastFired) {
    const { hour, minute, day } = getTaiwanTime();
    const now = Date.now();
    const fiveMin = 5 * 60 * 1000;
    const lastMs = lastFired ? new Date(lastFired).getTime() : 0;

    const daily = schedule.match(/^daily at (\d{2}):(\d{2})$/);
    if (daily) {
        return hour === +daily[1] && minute === +daily[2] && now - lastMs > fiveMin;
    }

    const weekday = schedule.match(/^weekday at (\d{2}):(\d{2})$/);
    if (weekday) {
        return day >= 1 && day <= 5 && hour === +weekday[1] && minute === +weekday[2] && now - lastMs > fiveMin;
    }

    const every = schedule.match(/^every (\d+) hours?$/);
    if (every) {
        const intervalMs = +every[1] * 60 * 60 * 1000;
        return now - lastMs >= intervalMs;
    }

    return false;
}

async function fetchUrl(url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchedulerBot/1.0)' },
            signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        return text
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{3,}/g, '\n')
            .trim()
            .slice(0, 8000);
    } catch (err) {
        return `[無法抓取 ${url}：${err.message}]`;
    }
}

async function callGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '（無回應）';
}

async function sendTelegram(text) {
    // Split into ≤4000 char chunks to stay within Telegram limits
    for (let i = 0; i < text.length; i += 4000) {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(i, i + 4000) }),
            signal: AbortSignal.timeout(10000),
        });
    }
}

async function executeSchedule(name, config) {
    console.log(`[Daemon] Firing schedule: ${name}`);

    let prompt = `你是小B，一個專業的AI助理。請用繁體中文回應。\n\n任務：${config.task_prompt}\n`;

    if (config.data_urls?.length) {
        prompt += '\n以下是從指定網址抓取的內容：\n\n';
        for (const url of config.data_urls) {
            const content = await fetchUrl(url);
            prompt += `【來源：${url}】\n${content}\n\n`;
        }
    }

    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const result = await callGemini(prompt);
    await sendTelegram(`📋 【${name}】${now}\n\n${result}`);
    console.log(`[Daemon] Schedule ${name} done.`);
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function tick() {
    const schedules = loadSchedules();
    for (const [name, config] of Object.entries(schedules)) {
        if (shouldFire(config.schedule, config.last_fired)) {
            schedules[name].last_fired = new Date().toISOString();
            saveSchedules(schedules);
            executeSchedule(name, config).catch(async (err) => {
                console.error(`[Daemon] ${name} failed:`, err.message);
                await sendTelegram(`⚠️ 排程「${name}」執行失敗：${err.message}`).catch(() => {});
            });
        }
    }
}

console.log('[Daemon] Scheduler started. Checking every 60s. Timezone: Asia/Taipei');
setInterval(tick, 60 * 1000);
tick();

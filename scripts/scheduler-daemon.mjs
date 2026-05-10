import { load, save, shouldFire } from './lib/schedule-store.mjs';

const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID  = process.env.TELEGRAM_CHAT_ID;
const GEMINI_MODEL      = process.env.AGENT_MODEL?.replace('google/', '') || 'gemini-2.5-flash-preview';

if (!GEMINI_API_KEY)                        { console.error('[Daemon] GEMINI_API_KEY not set.');                        process.exit(1); }
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) { console.error('[Daemon] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set.'); process.exit(1); }

async function fetchUrl(url) {
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SchedulerBot/1.0)' },
            signal: AbortSignal.timeout(15000),
        });
        return (await res.text())
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
    console.log(`[Daemon] Firing: ${name}`);
    let prompt = `你是小B，一個專業的AI助理。請用繁體中文回應。\n\n任務：${config.task_prompt}\n`;
    if (config.data_urls?.length) {
        prompt += '\n以下是從指定網址抓取的內容：\n\n';
        for (const url of config.data_urls) {
            prompt += `【來源：${url}】\n${await fetchUrl(url)}\n\n`;
        }
    }
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    await sendTelegram(`📋 【${name}】${now}\n\n${await callGemini(prompt)}`);
    console.log(`[Daemon] Done: ${name}`);
}

async function tick() {
    const schedules = load();
    for (const [name, config] of Object.entries(schedules)) {
        if (shouldFire(config.schedule, config.last_fired)) {
            schedules[name].last_fired = new Date().toISOString();
            save(schedules);
            executeSchedule(name, config).catch(async (err) => {
                console.error(`[Daemon] ${name} failed:`, err.message);
                await sendTelegram(`⚠️ 排程「${name}」執行失敗：${err.message}`).catch(() => {});
            });
        }
    }
}

console.log('[Daemon] Started. Checking every 60s. Timezone: Asia/Taipei');
setInterval(tick, 60 * 1000);
tick();

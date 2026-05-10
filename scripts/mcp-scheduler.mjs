import { createMcpServer } from './lib/create-mcp-server.mjs';
import { load, save, validate } from './lib/schedule-store.mjs';

await createMcpServer('scheduler-mcp', '1.0.0', [
    {
        definition: {
            name: 'create_schedule',
            description: '建立定時任務。時間到時小B會自動抓取資料、撰寫報告並傳送給你。',
            inputSchema: {
                type: 'object',
                properties: {
                    name:        { type: 'string', description: '排程名稱，英數字加底線，例如 morning_news' },
                    schedule:    { type: 'string', description: '執行時間（台北時區）。格式：「daily at HH:MM」（每天）、「weekday at HH:MM」（週一至五）、「every N hours」（每 N 小時）' },
                    task_prompt: { type: 'string', description: '到時間要做的事，例如：收集今日科技新聞並用繁體中文寫摘要' },
                    data_urls:   { type: 'array', items: { type: 'string' }, description: '（選填）要抓取內容的網址列表' },
                },
                required: ['name', 'schedule', 'task_prompt'],
            },
        },
        handler({ name, schedule, task_prompt, data_urls }) {
            if (!validate(schedule)) throw new Error('格式錯誤。請使用：「daily at HH:MM」、「weekday at HH:MM」或「every N hours」');
            const schedules = load();
            schedules[name] = { schedule, task_prompt, data_urls: data_urls || [], created_at: new Date().toISOString(), last_fired: null };
            save(schedules);
            return `排程「${name}」已建立。\n時間：${schedule}\n任務：${task_prompt}`;
        },
    },
    {
        definition: {
            name: 'list_schedules',
            description: '列出目前所有已設定的排程。',
            inputSchema: { type: 'object', properties: {} },
        },
        handler() {
            const schedules = load();
            const keys = Object.keys(schedules);
            if (keys.length === 0) return '目前沒有任何排程。';
            return keys.map(k => {
                const s = schedules[k];
                const urls = s.data_urls?.length ? `\n  來源：${s.data_urls.join(', ')}` : '';
                return `• ${k}\n  時間：${s.schedule}\n  任務：${s.task_prompt}${urls}\n  上次執行：${s.last_fired || '尚未執行'}`;
            }).join('\n\n');
        },
    },
    {
        definition: {
            name: 'delete_schedule',
            description: '刪除指定的排程。',
            inputSchema: {
                type: 'object',
                properties: { name: { type: 'string', description: '要刪除的排程名稱' } },
                required: ['name'],
            },
        },
        handler({ name }) {
            const schedules = load();
            if (!schedules[name]) throw new Error(`找不到排程「${name}」。`);
            delete schedules[name];
            save(schedules);
            return `排程「${name}」已刪除。`;
        },
    },
]);

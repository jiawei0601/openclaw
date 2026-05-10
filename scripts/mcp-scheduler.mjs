import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';

const SCHEDULES_FILE = process.env.SCHEDULES_FILE || '/tmp/schedules.json';

function loadSchedules() {
    try {
        if (fs.existsSync(SCHEDULES_FILE)) {
            return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
        }
    } catch {}
    return {};
}

function saveSchedules(schedules) {
    fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

// Accepted formats:
//   daily at HH:MM
//   weekday at HH:MM   (Mon–Fri)
//   every N hours      (1–24)
function validateSchedule(s) {
    const daily = s.match(/^daily at (\d{2}):(\d{2})$/);
    const weekday = s.match(/^weekday at (\d{2}):(\d{2})$/);
    const every = s.match(/^every (\d+) hours?$/);
    if (!daily && !weekday && !every) return false;
    if (daily || weekday) {
        const [, h, m] = (daily || weekday);
        if (+h > 23 || +m > 59) return false;
    }
    if (every && (+every[1] < 1 || +every[1] > 24)) return false;
    return true;
}

const server = new Server(
    { name: 'scheduler-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'create_schedule',
            description: '建立定時任務。時間到時小B會自動抓取資料、撰寫報告並傳送給你。',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: '排程名稱，英數字加底線，例如 morning_news',
                    },
                    schedule: {
                        type: 'string',
                        description: '執行時間（台北時區）。格式：「daily at HH:MM」（每天）、「weekday at HH:MM」（週一至五）、「every N hours」（每 N 小時）',
                    },
                    task_prompt: {
                        type: 'string',
                        description: '到時間要做的事，例如：收集今日科技新聞並用繁體中文寫摘要',
                    },
                    data_urls: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '（選填）要抓取內容的網址列表',
                    },
                },
                required: ['name', 'schedule', 'task_prompt'],
            },
        },
        {
            name: 'list_schedules',
            description: '列出目前所有已設定的排程。',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'delete_schedule',
            description: '刪除指定的排程。',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '要刪除的排程名稱' },
                },
                required: ['name'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        if (name === 'create_schedule') {
            if (!validateSchedule(args.schedule)) {
                return {
                    content: [{ type: 'text', text: '格式錯誤。請使用：「daily at HH:MM」、「weekday at HH:MM」或「every N hours」' }],
                    isError: true,
                };
            }
            const schedules = loadSchedules();
            schedules[args.name] = {
                schedule: args.schedule,
                task_prompt: args.task_prompt,
                data_urls: args.data_urls || [],
                created_at: new Date().toISOString(),
                last_fired: null,
            };
            saveSchedules(schedules);
            return {
                content: [{ type: 'text', text: `排程「${args.name}」已建立。\n時間：${args.schedule}\n任務：${args.task_prompt}` }],
            };
        }

        if (name === 'list_schedules') {
            const schedules = loadSchedules();
            const keys = Object.keys(schedules);
            if (keys.length === 0) {
                return { content: [{ type: 'text', text: '目前沒有任何排程。' }] };
            }
            const list = keys.map(k => {
                const s = schedules[k];
                const urls = s.data_urls?.length ? `\n  來源：${s.data_urls.join(', ')}` : '';
                return `• ${k}\n  時間：${s.schedule}\n  任務：${s.task_prompt}${urls}\n  上次執行：${s.last_fired || '尚未執行'}`;
            }).join('\n\n');
            return { content: [{ type: 'text', text: list }] };
        }

        if (name === 'delete_schedule') {
            const schedules = loadSchedules();
            if (!schedules[args.name]) {
                return { content: [{ type: 'text', text: `找不到排程「${args.name}」。` }], isError: true };
            }
            delete schedules[args.name];
            saveSchedules(schedules);
            return { content: [{ type: 'text', text: `排程「${args.name}」已刪除。` }] };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);

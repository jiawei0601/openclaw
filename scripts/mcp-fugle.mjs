import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_KEY = process.env.FUGLE_API_KEY;
const BASE_URL = 'https://api.fugle.tw/marketdata/v1.0';

async function fugleGet(path) {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
        headers: { 'X-API-KEY': API_KEY },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Fugle API error ${res.status}: ${text}`);
    }
    return res.json();
}

async function getStockQuote(symbol) {
    const data = await fugleGet(`/stock/intraday/quote?symbol=${symbol}`);
    const q = data;
    return {
        symbol: q.symbol,
        name: q.name,
        open: q.openPrice,
        high: q.highPrice,
        low: q.lowPrice,
        close: q.closePrice,
        change: q.change,
        changePercent: q.changePercent,
        volume: q.volume,
        tradeValue: q.tradeValue,
        lastUpdated: q.date,
    };
}

async function getStockCandles(symbol, from, to) {
    const params = new URLSearchParams({ symbol, from, to });
    const data = await fugleGet(`/stock/historical/candles?${params}`);
    return (data.data || []).map(c => ({
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
}

const server = new Server(
    { name: 'fugle-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'get_stock_quote',
            description: '查詢台股個股即時報價，包含股價、漲跌幅、成交量等資訊。',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: {
                        type: 'string',
                        description: '股票代號，例如 2330（台積電）、0050（元大台灣50）',
                    },
                },
                required: ['symbol'],
            },
        },
        {
            name: 'get_stock_candles',
            description: '查詢台股個股歷史K線資料（日K），可指定起訖日期。',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: {
                        type: 'string',
                        description: '股票代號，例如 2330',
                    },
                    from: {
                        type: 'string',
                        description: '起始日期，格式 YYYY-MM-DD',
                    },
                    to: {
                        type: 'string',
                        description: '結束日期，格式 YYYY-MM-DD',
                    },
                },
                required: ['symbol', 'from', 'to'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === 'get_stock_quote') {
            const result = await getStockQuote(args.symbol);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }

        if (name === 'get_stock_candles') {
            const result = await getStockCandles(args.symbol, args.from, args.to);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2),
                }],
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);

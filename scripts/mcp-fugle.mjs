import { createMcpServer } from './lib/create-mcp-server.mjs';

const API_KEY  = process.env.FUGLE_API_KEY;
const BASE_URL = 'https://api.fugle.tw/marketdata/v1.0';

async function fugleGet(path) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { 'X-API-KEY': API_KEY } });
    if (!res.ok) throw new Error(`Fugle API error ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
}

async function getStockQuote(symbol) {
    const q = await fugleGet(`/stock/intraday/quote?symbol=${symbol}`);
    return { symbol: q.symbol, name: q.name, open: q.openPrice, high: q.highPrice, low: q.lowPrice, close: q.closePrice, change: q.change, changePercent: q.changePercent, volume: q.volume, tradeValue: q.tradeValue, lastUpdated: q.date };
}

async function getStockCandles(symbol, from, to) {
    const data = await fugleGet(`/stock/historical/candles?${new URLSearchParams({ symbol, from, to })}`);
    return (data.data || []).map(c => ({ date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
}

await createMcpServer('fugle-mcp', '1.0.0', [
    {
        definition: {
            name: 'get_stock_quote',
            description: '查詢台股個股即時報價，包含股價、漲跌幅、成交量等資訊。',
            inputSchema: {
                type: 'object',
                properties: { symbol: { type: 'string', description: '股票代號，例如 2330（台積電）、0050（元大台灣50）' } },
                required: ['symbol'],
            },
        },
        handler: ({ symbol }) => getStockQuote(symbol),
    },
    {
        definition: {
            name: 'get_stock_candles',
            description: '查詢台股個股歷史K線資料（日K），可指定起訖日期。',
            inputSchema: {
                type: 'object',
                properties: {
                    symbol: { type: 'string', description: '股票代號，例如 2330' },
                    from:   { type: 'string', description: '起始日期，格式 YYYY-MM-DD' },
                    to:     { type: 'string', description: '結束日期，格式 YYYY-MM-DD' },
                },
                required: ['symbol', 'from', 'to'],
            },
        },
        handler: ({ symbol, from, to }) => getStockCandles(symbol, from, to),
    },
]);

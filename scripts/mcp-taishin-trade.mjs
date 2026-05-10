import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { TaishinSDK, BSAction, TimeInForce, OrderType, PriceType, MarketType } = require('taishin-sdk');

const CERT_B64    = process.env.TAISHIN_CERT;
const CERT_PASS   = process.env.TAISHIN_CERT_PASS;
const PERSONAL_ID = process.env.TAISHIN_PERSONAL_ID;
const PASSWORD    = process.env.TAISHIN_PASSWORD;
const IS_PAPER    = process.env.TAISHIN_PAPER === '1';

// 安全限制：單筆最多 5 張（5000 股）
const MAX_SHARES = 5000;

// 寫憑證到暫存檔
const certPath = path.join(os.tmpdir(), 'taishin-cert.pfx');
fs.writeFileSync(certPath, Buffer.from(CERT_B64, 'base64'));

const sdk = new TaishinSDK();
let _account = null;

function getAccount() {
    if (_account) return _account;
    const result = sdk.login(PERSONAL_ID, PASSWORD, certPath, CERT_PASS);
    _account = result.data[0];
    return _account;
}

async function placeOrder({ symbol, side, quantity, price, priceType, timeInForce }) {
    if (quantity > MAX_SHARES) throw new Error(`委託股數超過上限（最多 ${MAX_SHARES} 股）`);
    if (IS_PAPER) {
        return { paper: true, symbol, side, quantity, price, message: '模擬下單成功（未實際送出）' };
    }
    const account = getAccount();
    const order = {
        buySell: side === 'B' ? BSAction.Buy : BSAction.Sell,
        symbol,
        price: String(price),
        quantity,
        marketType: MarketType.Common,
        priceType: priceType === 'market' ? PriceType.Market : PriceType.Limit,
        timeInForce: timeInForce === 'IOC' ? TimeInForce.IOC
                   : timeInForce === 'FOK' ? TimeInForce.FOK
                   : TimeInForce.ROD,
        orderType: OrderType.Stock,
    };
    return sdk.stock.placeOrder(account, order, false);
}

async function cancelOrder({ orderNo, workDate }) {
    if (IS_PAPER) return { paper: true, message: '模擬取消成功' };
    const account = getAccount();
    // cancelOrder 需要傳入完整 order 物件（orderNo + workDate）
    return sdk.stock.cancelOrder(account, { orderNo, workDate });
}

async function getOrders() {
    const account = getAccount();
    return sdk.stock.getOrders(account);
}

async function getInventories() {
    const account = getAccount();
    return sdk.stock.getInventories(account);
}

async function getBalance() {
    const account = getAccount();
    return sdk.stock.getBalance(account);
}

async function getTransactions({ duration }) {
    const account = getAccount();
    return sdk.stock.getTransactions(account, { duration });
}

async function getSettlements() {
    const account = getAccount();
    return sdk.stock.getSettlements(account);
}

const server = new Server(
    { name: 'taishin-trade-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'place_order',
            description: `台新證券下單委託${IS_PAPER ? '（⚠️ 模擬模式，不會真實成交）' : '（⚠️ 真實交易）'}。執行前必須先向使用者確認。單筆上限 ${MAX_SHARES} 股。`,
            inputSchema: {
                type: 'object',
                properties: {
                    symbol:      { type: 'string', description: '股票代號，例如 2330' },
                    side:        { type: 'string', enum: ['B', 'S'], description: 'B=買進 S=賣出' },
                    quantity:    { type: 'number', description: '股數（1張=1000股）' },
                    price:       { type: 'number', description: '委託價格（市價單填 0）' },
                    priceType:   { type: 'string', enum: ['limit', 'market'], description: '限價或市價' },
                    timeInForce: { type: 'string', enum: ['ROD', 'IOC', 'FOK'], description: 'ROD=當日有效 IOC=立即成交否則取消 FOK=全部成交否則取消' },
                },
                required: ['symbol', 'side', 'quantity', 'price', 'priceType', 'timeInForce'],
            },
        },
        {
            name: 'cancel_order',
            description: '取消委託單。需要先用 get_orders 取得委託清單，再帶入 orderNo 和 workDate 取消。',
            inputSchema: {
                type: 'object',
                properties: {
                    orderNo:  { type: 'string', description: '委託書編號（從 get_orders 或 place_order 回傳取得）' },
                    workDate: { type: 'string', description: '委託有效交易日，格式 YYYYMMDD（從 get_orders 或 place_order 回傳取得）' },
                },
                required: ['orderNo', 'workDate'],
            },
        },
        {
            name: 'get_orders',
            description: '查詢今日委託清單（含未成交、已成交、已取消）',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'get_inventories',
            description: '查詢目前持股（庫存）',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'get_balance',
            description: '查詢帳戶可用資金與銀行餘額',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'get_transactions',
            description: '查詢近期成交明細',
            inputSchema: {
                type: 'object',
                properties: {
                    duration: {
                        type: 'string',
                        enum: ['1m', '3m', '6m'],
                        description: '查詢區間：1m=近1個月, 3m=近3個月, 6m=近6個月',
                    },
                },
                required: ['duration'],
            },
        },
        {
            name: 'get_settlements',
            description: '查詢未來應收付款（交割款項）',
            inputSchema: { type: 'object', properties: {} },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        if      (name === 'place_order')     result = await placeOrder(args);
        else if (name === 'cancel_order')    result = await cancelOrder(args);
        else if (name === 'get_orders')      result = await getOrders();
        else if (name === 'get_inventories') result = await getInventories();
        else if (name === 'get_balance')     result = await getBalance();
        else if (name === 'get_transactions') result = await getTransactions(args);
        else if (name === 'get_settlements') result = await getSettlements();
        else throw new Error(`Unknown tool: ${name}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);

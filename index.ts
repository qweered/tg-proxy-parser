import * as cheerio from "cheerio";
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync } from "fs";

console.clear();

if (!existsSync('config-tg.txt')) writeFileSync('config-tg.txt', '');

const jsonLoad = (path: string): string[] => existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : [];

const substringDel = (list: string[]): string[] => {
    const sorted = list.sort((a, b) => a.length - b.length);
    const toRemove = new Set<string>();
    
    for (let i = 0; i < sorted.length; i++) {
        const s1 = sorted[i];
        if (typeof s1 !== "string") continue;
        for (let j = i + 1; j < sorted.length; j++) {
            const s2 = sorted[j];
            if (typeof s2 !== "string") continue;
            if (s2.includes(s1)) {
                toRemove.add(s1);
                break;
            }
        }
    }
    return list.filter(item => !toRemove.has(item));
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}:${Math.floor((s % 3600) / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
};

let tgChannels = jsonLoad('telegram_channels.json').filter(x => x.length >= 5);
const invalidChannels = jsonLoad('invalid_channels.json')

// Remove known invalid channels from scraping - no point re-checking them
tgChannels = tgChannels.filter(ch => !invalidChannels.includes(ch));

const threads = parseInt((prompt('\nThreads for parsing: ') || '50'));
const depth = parseInt((prompt('\nParsing depth (1dp = 20 last tg posts): ') || '1'));

console.log(`\nChannels to scrape: ${tgChannels.length}, Known invalid: ${invalidChannels.length}`);

const startTime = Date.now();

console.log('Extracting channel names from config-tg.txt...');
const existingConfigs = existsSync("config-tg.txt") 
    ? readFileSync("config-tg.txt", "utf-8").split('\n').filter(Boolean)
    : [];

const telegramPattern = /(?:@|%40|t\.me[%2F/]|t\.me-)(\w{5,})/gi;
const newChannels = new Set<string>();

for (let config of existingConfigs) {
    // Try to decode base64 configs
    for (const prefix of ['vmess://', 'ssr://']) {
        if (config.startsWith(prefix)) {
            try { config = atob(config.slice(prefix.length - 3)); } catch {}
        }
    }
    
    // Extract channel names
    [...config.matchAll(telegramPattern)]
        .flatMap(match => match.slice(1).filter(Boolean))
        .forEach(name => {
            const clean = name.toLowerCase().replace(/[^\x00-\x7F]/g, "");
            if (clean.length >= 5) newChannels.add(clean);
        });
    
    try {
        [...atob(config).matchAll(telegramPattern)]
            .flatMap(match => match.slice(1).filter(Boolean))
            .forEach(name => {
                const clean = name.toLowerCase().replace(/[^\x00-\x7F]/g, "");
                if (clean.length >= 5) newChannels.add(clean);
            });
    } catch {}
}

const oldCount = tgChannels.length;
// Filter out channels that are already known to be invalid
const filteredNewChannels = [...newChannels].filter(ch => !invalidChannels.includes(ch));
tgChannels = [...new Set([...tgChannels, ...filteredNewChannels])].sort();
console.log(`Found ${newChannels.size} extracted channels, ${filteredNewChannels.length} new (${newChannels.size - filteredNewChannels.length} already invalid)`);
console.log(`Total channels: ${oldCount} -> ${tgChannels.length}`);

writeFileSync('telegram_channels.json', JSON.stringify(tgChannels, null, 4));
console.log(`Channel extraction completed - ${formatTime(Date.now() - startTime)}\n`);

// Semaphore for concurrency control
class Semaphore {
    private permits: number;
    private waitQueue: (() => void)[] = [];

    constructor(permits: number) { this.permits = permits; }

    acquire(): Promise<void> {
        return new Promise(resolve => {
            if (this.permits > 0) {
                this.permits--;
                resolve();
            } else {
                this.waitQueue.push(resolve);
            }
        });
    }

    release(): void {
        this.permits++;
        const resolve = this.waitQueue.shift();
        if (resolve) {
            this.permits--;
            resolve();
        }
    }
}

// Main parsing function
const sem = new Semaphore(threads);
const codes: string[] = [];
const validChannels: string[] = [];
const newInvalidChannels: string[] = [];

const parseChannel = async (channel: string, index: number): Promise<void> => {
    await sem.acquire();
    
    try {
        const htmlPages: string[] = [];
        let url = channel;
        let foundConfigs = false;
        
        // Fetch pages with pagination
        for (let i = 1; i <= depth; i++) {
            while (true) {
                try {
                    const response = await fetch(`https://t.me/s/${url}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
                    });
                    const text = await response.text();
                    htmlPages.push(text);
                    
                    // Get next page token
                    const match = text.match(/data-before="(\d+)"/);
                    if (!match) break;
                    url = `${channel}?before=${match[1]}`;
                    break;
                } catch {
                    await sleep(randomInt(5000, 25000));
                }
            }
            
            if (i === depth) console.log(`${index + 1}/${tgChannels.length} - ${channel}`);
        }
        
        // Parse HTML for proxy configs
        const protocols = ['vless://', 'ss://', 'vmess://', 'trojan://', 'tuic://', 'hysteria://', 
                          'hy2://', 'hysteria2://', 'juicity://', 'nekoray://', 'sn://', 'husi://', 
                          'exclave://', 'ulink://', 'socks4://', 'socks5://', 'socks://', 'naive+', 
                          'wireguard://', 'wg://'];
        
        for (const page of htmlPages) {
            const $ = cheerio.load(page);
            $('.tgme_widget_message_text').each((_, el) => {
                const content = $(el).html()?.split('<br/>') || [];
                for (const line of content) {
                    if (protocols.some(p => line.includes(p))) {
                        codes.push(line.replace(/<.*?>/g, ''));
                        foundConfigs = true;
                    }
                }
            });
        }
        
        if (foundConfigs) {
            validChannels.push(channel);
        } else {
            newInvalidChannels.push(channel);
        }
    } finally {
        sem.release();
    }
};

console.log('Starting parallel parsing...\n');
await Promise.all(tgChannels.map((ch, i) => parseChannel(ch, i)));

console.log(`\nParsing completed - ${formatTime(Date.now() - startTime)}`);
console.log(`Parsing results: ${validChannels.length} valid, ${newInvalidChannels.length} invalid`);
console.log('Processing and cleaning configurations...');

// Clean and validate configs
const cleanConfig = (config: string): string[] => {
    const results: string[] = [];
    
    // Basic cleanup
    let clean = config
        .replace(/%0A|%250A|%0D/g, '')
        .replace(/\s|\x00|\x01|amp;|/g, '')
        .replace(/fp=(firefox|safari|edge|360|qq|ios|android|randomized|random)/g, 'fp=chrome');
    
    // Safe URI decoding
    try {
        clean = decodeURIComponent(decodeURIComponent(clean));
    } catch {
        try { clean = decodeURIComponent(clean); } catch {}
    }
    
    // Protocol-specific processing
    const protocolHandlers: Record<string, (part: string) => string[]> = {
        'vmess://': (p) => [`vmess://${p.split('vmess://')[1]}`],
        'vless://': (p) => {
            const url = `vless://${p.split('vless://')[1]}`;
            return url.includes('flow=xtls-rprx-direct') || !url.includes('@') || !url.substring(8).includes(':') 
                ? [] : [url];
        },
        'ss://': (p) => [`ss://${p.split('ss://')[1]}`.replace(/;;/g, ';')],
        'trojan://': (p) => {
            const url = `trojan://${p.split('trojan://')[1]}`;
            return url.includes('@') && url.substring(9).includes(':') ? [url] : [];
        },
        'tuic://': (p) => {
            const url = `tuic://${p.split('tuic://')[1]}`;
            return url.substring(7).includes(':') && url.includes('@') ? [url] : [];
        },
        'hysteria://': (p) => {
            const url = `hysteria://${p.split('hysteria://')[1]}`;
            return url.substring(11).includes(':') && url.includes('=') ? [url] : [];
        },
        'hysteria2://': (p) => {
            const url = `hysteria2://${p.split('hysteria2://')[1]}`;
            return url.includes('@') && url.substring(12).includes(':') ? [url] : [];
        },
        'hy2://': (p) => {
            const url = `hy2://${p.split('hy2://')[1]}`;
            return url.includes('@') && url.substring(6).includes(':') ? [url] : [];
        },
        'sn://': (p) => {
            const base = p.split('sn://')[1];
            return [`sn://${base}`, `husi://${base}`, `exclave://${base}`];
        },
        'husi://': (p) => {
            const base = p.split('husi://')[1];
            return [`sn://${base}`, `husi://${base}`, `exclave://${base}`];
        },
        'exclave://': (p) => {
            const base = p.split('exclave://')[1];
            return [`sn://${base}`, `husi://${base}`, `exclave://${base}`];
        },
        'socks4://': (p) => {
            const url = `socks4://${p.split('socks4://')[1]}`;
            return url.substring(9).includes(':') ? [url] : [];
        },
        'socks5://': (p) => {
            const url = `socks5://${p.split('socks5://')[1]}`;
            return url.substring(9).includes(':') ? [url] : [];
        },
        'socks://': (p) => {
            const url = `socks://${p.split('socks://')[1]}`;
            return url.substring(8).includes(':') ? [url] : [];
        },
        'naive+': (p) => {
            const url = `naive+${p.split('naive+')[1]}`;
            return url.substring(13).includes(':') && url.includes('@') ? [url] : [];
        }
    };
    
    // Simple handlers for other protocols
    for (const protocol of ['juicity://', 'nekoray://', 'ulink://', 'wireguard://', 'wg://']) {
        if (clean.includes(protocol)) {
            results.push(`${protocol}${clean.split(protocol)[1]}`);
            return results;
        }
    }
    
    // Use specific handlers
    for (const [protocol, handler] of Object.entries(protocolHandlers)) {
        if (clean.includes(protocol)) {
            results.push(...handler(clean));
            break;
        }
    }
    
    return results.map(r => r.trim()).filter(Boolean);
};

// Process all configs
const processedConfigs = [...new Set(codes)]
    .flatMap(cleanConfig)
    .filter(c => c.length > 13 && (!c.includes('…') || c.includes('#')))
    .map(c => c.replace(/…»?|»|%{1,2}|`$/g, '').trim())
    .filter(Boolean);

const finalConfigs = substringDel([...new Set(processedConfigs)]).sort();

// Save results - channels that produced configs are valid, others are invalid
const scrapedChannels = new Set([...validChannels, ...newInvalidChannels]);
const uniqueValidChannels = [...new Set(validChannels)].sort();

// All channels that didn't produce configs (both newly found and previously known)
const allInvalidChannels = [
    ...invalidChannels,  // Previously known invalid
    ...newInvalidChannels,  // Newly discovered invalid
    ...tgChannels.filter(ch => !scrapedChannels.has(ch))  // Channels that weren't processed
];
const uniqueInvalidChannels = [...new Set(allInvalidChannels)].sort();

console.log(`\nNew invalid channels: ${newInvalidChannels.length}, Old invalid channels: ${invalidChannels.length}`);
console.log(`Total unique invalid channels: ${uniqueInvalidChannels.length}`);
console.log(`\nResults: ${uniqueValidChannels.length} valid channels, ${finalConfigs.length} configs`);

console.log('\nSaving files...');
writeFileSync('telegram_channels.json', JSON.stringify(uniqueValidChannels, null, 4));
writeFileSync('invalid_channels.json', JSON.stringify(uniqueInvalidChannels, null, 4));
writeFileSync('config-tg.txt', finalConfigs.join('\n') + '\n');
console.log('Files saved successfully!');

console.log(`\nCompleted in ${formatTime(Date.now() - startTime)}`);
process.exit(0);
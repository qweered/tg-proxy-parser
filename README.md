# Telegram Proxy Parser (TypeScript/Bun)

A TypeScript port of the Telegram proxy configuration parser, optimized for Bun runtime.

## Features

- Parses Telegram channels for proxy configurations
- Supports multiple proxy protocols (VMess, VLess, Shadowsocks, Trojan, etc.)
- Multi-threaded parsing with configurable concurrency
- Automatic deduplication and validation
- Configuration cleanup and normalization

## Prerequisites

- [Bun](https://bun.sh/) runtime installed
- Internet connection for fetching Telegram channel data

## Setup

1. Install dependencies:
```bash
bun install
```

2. Create initial JSON files (if they don't exist):
```bash
echo "[]" > "telegram channels.json"
echo "[]" > "invalid telegram channels.json"
```

## Usage

Run the script:
```bash
bun run index.ts
```

The script will prompt you for:
- Number of parsing threads
- Parsing depth (1 depth = ~20 recent posts)
- Whether to include invalid channels

## Output Files

- `telegram channels.json` - Valid channels with proxy configs
- `invalid telegram channels.json` - Channels without proxy configs  
- `config-tg.txt` - Extracted and cleaned proxy configurations

## Supported Proxy Protocols

- VMess (`vmess://`)
- VLess (`vless://`)
- Shadowsocks (`ss://`)
- Trojan (`trojan://`)
- TUIC (`tuic://`)
- Hysteria/Hysteria2 (`hysteria://`, `hysteria2://`, `hy2://`)
- Juicity (`juicity://`)
- SOCKS4/5 (`socks4://`, `socks5://`, `socks://`)
- Naive (`naive+`)
- WireGuard (`wireguard://`, `wg://`)
- And more...

## Migration from Python

This TypeScript version maintains full compatibility with the original Python script:
- Same input/output file formats
- Identical parsing logic and validation rules
- Same configuration cleaning and normalization
- Compatible threading model using async/await

## Performance

The TypeScript version leverages:
- Native Bun HTTP client for faster requests
- Async/await for efficient concurrency
- Cheerio for fast HTML parsing
- Built-in JSON handling 
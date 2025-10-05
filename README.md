# WTTP Bridge

HTTP to WTTP protocol bridge server. Converts HTTP requests to WTTP protocol requests and serves the content.

## Features

- **Path-Based Routing:** Access WTTP content via `http://localhost:3000/{wttp-address}`
- **Domain-Based Routing:** Access WTTP content via custom domains with DNS TXT records
- **Automatic URL Rewriting:** Converts wttp:// URLs in HTML to bridge URLs
- **CORS Support:** Enables cross-origin requests for web applications
- **Debug Logging:** Comprehensive console logging for troubleshooting

## Installation

```bash
npm install
```

## Usage

Start the server:
```bash
npm start
```

Server runs on `http://localhost:3000` by default. Set `PORT` environment variable to change.

## Two Operating Modes

### 1. Bridge Domains (Path-Based)
The bridge runs at **wttp.page** and **wttp.link**. Everything after `/` becomes the WTTP URL path.

**Example:**
```
http://wttp.page/wordl3.eth/ → wttp://wordl3.eth/
http://wttp.link/wordl3.eth/style.css → wttp://wordl3.eth/style.css
http://localhost:3000/wordl3.eth/ → wttp://wordl3.eth/ (for local testing)
```

### 2. Custom Domains (TXT Record-Based)
Any OTHER domain (not wttp.page/wttp.link) triggers DNS TXT record lookup.

**TXT Record Format:** `v=wttp; a=<address>; chain=<chainId>;`

**Example:**
```
DNS: your-domain.com TXT "v=wttp; a=wordl3.eth; chain=11155111;"
http://your-domain.com/ → wttp://wordl3.eth:11155111/
http://your-domain.com/page.html → wttp://wordl3.eth:11155111/page.html

Without chain:
DNS: your-domain.com TXT "v=wttp; a=wordl3.eth;"
http://your-domain.com/ → wttp://wordl3.eth/
```

## Testing

See [TESTING.md](TESTING.md) for detailed testing instructions.

Quick test:
```bash
curl http://localhost:3000/wordl3.eth/
```

## Configuration

Edit `BRIDGE_DOMAINS` array in `index.js` to add more bridge domains (path-based routing):
```javascript
const BRIDGE_DOMAINS = ['wttp.link', 'wttp.page', 'localhost', '127.0.0.1'];
```

Any domain NOT in this list will trigger TXT record lookup.

## How It Works

1. Server receives HTTP request
2. Checks if hostname is a bridge domain (wttp.page, wttp.link, localhost)
   - **Yes:** Path-based routing → `wttp://{path}`
   - **No:** Custom domain → lookup DNS TXT record → `wttp://{txt-value}{path}`
3. Constructs WTTP URL
4. Fetches content via WTTP protocol
5. Transforms HTML content (replaces wttp:// URLs)
6. Returns content to client

## License

MIT


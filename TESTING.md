# WTTP Bridge - Testing Guide

## Overview
This bridge server converts HTTP requests to WTTP protocol requests and returns the content.

## Two Operating Modes

### Mode 1: Bridge Domains (Path-Based Routing)
The bridge runs at **wttp.page**, **wttp.link**, and **localhost**. Everything after `/` becomes the WTTP URL.

**Format:** `http://wttp.page/{wttp-path}` → `wttp://{wttp-path}`

### Mode 2: Custom Domains (TXT Record-Based Routing)
Any OTHER domain (not wttp.page/wttp.link) triggers DNS TXT record lookup.

**Format:** `http://your-domain.com/{path}` → `wttp://{txt-record-value}/{path}`

## Testing Instructions

### Test 1: Bridge Domain - Basic WTTP Sites

1. Start the server:
```bash
npm start
```

2. Test these URLs in your browser or curl:
```bash
# Health check
curl http://localhost:3000/

# WTTP sites via bridge
curl http://localhost:3000/wordl3.eth/
curl http://localhost:3000/minesweep.eth/
curl http://localhost:3000/etherdoom.eth/
```

**Expected Results:**
- Console logs show: `[URL Builder] Bridge domain, built WTTP URL: wttp://wordl3.eth/`
- HTML content returned with wttp:// URLs replaced with bridge URLs

### Test 2: Bridge Domain - Nested Paths

```bash
curl http://localhost:3000/wordl3.eth/style.css
curl http://localhost:3000/wordl3.eth/scripts/app.js
```

**Expected Results:**
- Converts to `wttp://wordl3.eth/style.css` and `wttp://wordl3.eth/scripts/app.js`
- Returns the appropriate file content
- Correct Content-Type headers

### Test 3: Custom Domain (Requires DNS Setup)

1. Set up a DNS TXT record for YOUR custom domain (NOT wttp.link/wttp.page):
```
Host: your-custom-domain.com
Type: TXT
Value: v=wttp; a=wordl3.eth; chain=11155111;
```

2. Test the custom domain:
```bash
curl http://your-custom-domain.com/
curl http://your-custom-domain.com/style.css
```

**Expected Results:**
- Console shows: `[URL Builder] Custom domain detected, looking up TXT record...`
- Console shows: `[DNS] Found X TXT record(s): ...`
- Console shows: `[DNS] Parsed TXT record: { v: 'wttp', a: 'wordl3.eth', chain: '11155111' }`
- Converts to `wttp://wordl3.eth:11155111/` and `wttp://wordl3.eth:11155111/style.css`
- Returns content as if accessing wordl3.eth on chain 11155111

**Without chain parameter:**
```
Value: v=wttp; a=wordl3.eth;
Result: wttp://wordl3.eth/
```

### Test 4: Browser Testing

Open in browser:
```
http://localhost:3000/wordl3.eth/
```

**Expected Results:**
- Page loads fully
- All assets (CSS, JS, images) load correctly
- Internal links work properly
- Check browser console for any 404s

## What to Report Back

After testing, please report:

1. **Console Output:** Copy the server console logs for a sample request
2. **HTTP Status Codes:** What status codes did you receive? (200, 404, 500, etc.)
3. **Content Received:** Did you get HTML/CSS/JS content?
4. **Browser Rendering:** Does the page display correctly in browser?
5. **Asset Loading:** Do images, stylesheets, and scripts load?
6. **Link Behavior:** Do internal links navigate correctly?
7. **Errors:** Any error messages in server or browser console?

## Debugging Information

The server logs include:
- `[Request]` - Incoming HTTP request details
- `[URL Builder]` - How the WTTP URL is constructed
- `[DNS]` - TXT record lookup results (for custom domains)
- `[WTTP]` - WTTP fetch request and response
- `[Transform]` - URL transformation for HTML content
- `[Bridge]` - Request completion status
- `[ERROR]` - Any errors that occur

## Common Issues

1. **TXT Record Not Found:** Custom domain will fall back to using the hostname directly
2. **404 Errors:** WTTP resource doesn't exist at that address
3. **Timeout Errors:** WTTP network is slow or unreachable
4. **CORS Errors:** Should be handled automatically by the bridge


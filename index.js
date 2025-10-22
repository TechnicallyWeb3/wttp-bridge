const express = require('express');
const dns = require('dns').promises;
const { WTTPHandler } = require('@wttp/handler');

const app = express();
const port = process.env.PORT || 3000;

// Initialize WTTP handler
const wttp = new WTTPHandler(undefined, "polygon");

// Configuration
const BRIDGE_DOMAINS = ['wttp.link', 'wttp.page', 'localhost', '127.0.0.1'];
const DEFAULT_BRIDGE_URL = 'https://wttp.link/';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a hostname is a bridge domain
 */
function isBridgeDomain(hostname) {
  return BRIDGE_DOMAINS.some(domain => 
    hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

/**
 * Check if a string is an Ethereum address (0x followed by 40 hex chars)
 */
function isEthereumAddress(str) {
  if (!str) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(str);
}

/**
 * Check if a string is an ENS address (ends with .eth)
 */
function isENSAddress(str) {
  if (!str) return false;
  return /^[a-zA-Z0-9-]+\.eth$/.test(str);
}

/**
 * Check if a string is a contract or ENS address
 */
function isContractOrENSAddress(str) {
  return isEthereumAddress(str) || isENSAddress(str);
}

/**
 * Extract the first path segment from a URL or path
 */
function getFirstPathSegment(pathOrUrl) {
  try {
    // If it's a full URL, parse it
    if (pathOrUrl && (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://'))) {
      const url = new URL(pathOrUrl);
      const segments = url.pathname.split('/').filter(s => s);
      return segments[0] || null;
    }
    // Otherwise treat as path
    const segments = pathOrUrl.split('/').filter(s => s);
    return segments[0] || null;
  } catch (error) {
    return null;
  }
}

// ============================================================================
// DNS LOOKUP
// ============================================================================

/**
 * Look up and parse WTTP TXT records for a given hostname
 * Expected format: v=wttp3; a=tw3.eth; chain=11155111;
 * Returns: { address: 'tw3.eth', chain: '11155111' } or null
 */
async function lookupTXTRecord(hostname) {
  const wttpHostname = `wttp.${hostname}`;
  console.log(`[DNS] Looking up TXT records for: ${wttpHostname}`);
  
  try {
    const records = await dns.resolveTxt(wttpHostname);
    console.log(`[DNS] Found ${records.length} TXT record(s)`);
    
    for (const record of records) {
      const txtValue = Array.isArray(record) ? record.join('') : record;
      
      if (!txtValue.includes('v=wttp3')) {
        continue;
      }
      
      const parsed = {};
      const parts = txtValue.split(';').map(s => s.trim()).filter(s => s);
      
      for (const part of parts) {
        const [key, value] = part.split('=').map(s => s.trim());
        if (key && value) {
          parsed[key] = value;
        }
      }
      
      if (parsed.v === 'wttp3' && parsed.a) {
        console.log(`[DNS] Valid WTTP record found: ${parsed.a}`);
        return {
          address: parsed.a,
          chain: parsed.chain || null
        };
      }
    }
    
    console.log(`[DNS] No valid WTTP TXT record found`);
    return null;
  } catch (error) {
    console.log(`[DNS] Error looking up TXT records: ${error.message}`);
    return null;
  }
}

// ============================================================================
// WTTP URL BUILDERS
// ============================================================================

/**
 * Build WTTP URL for custom domains (using TXT records)
 */
async function buildCustomDomainWTTPUrl(hostname, path) {
  console.log(`[Custom Domain] Looking up TXT record for: ${hostname}`);
  
  const txtRecord = await lookupTXTRecord(hostname);
  if (txtRecord) {
    let wttpUrl;
    if (txtRecord.chain) {
      wttpUrl = `wttp://${txtRecord.address}:${txtRecord.chain}${path}`;
    } else {
      wttpUrl = `wttp://${txtRecord.address}${path}`;
    }
    console.log(`[Custom Domain] Built WTTP URL: ${wttpUrl}`);
    return wttpUrl;
  }
  
  console.log(`[Custom Domain] No TXT record found, using hostname directly`);
  return `wttp://${hostname}${path}`;
}

/**
 * Build WTTP URL for bridge domains (path-based routing)
 */
function buildBridgeDomainWTTPUrl(path) {
  // Remove leading slash and convert to wttp://
  const wttpPath = path.startsWith('/') ? path.substring(1) : path;
  const wttpUrl = `wttp://${wttpPath}`;
  console.log(`[Bridge Domain] Built WTTP URL: ${wttpUrl}`);
  return wttpUrl;
}

/**
 * Build fallback WTTP URL using referer path
 */
function buildFallbackWTTPUrl(originalPath, referer) {
  const refererFirstSegment = getFirstPathSegment(referer);
  
  if (refererFirstSegment && isContractOrENSAddress(refererFirstSegment)) {
    // Prepend the referer's first segment to the current path
    const fallbackPath = `/${refererFirstSegment}${originalPath}`;
    const fallbackUrl = `wttp://${fallbackPath.substring(1)}`;
    console.log(`[Fallback] Built fallback URL: ${fallbackUrl}`);
    return fallbackUrl;
  }
  
  console.log(`[Fallback] Referer does not contain valid contract/ENS address`);
  return null;
}

// ============================================================================
// WTTP FETCHING
// ============================================================================

/**
 * Fetch content from WTTP and return response
 */
async function fetchWTTPContent(wttpUrl) {
  console.log(`[WTTP] Fetching: ${wttpUrl}`);
  const response = await wttp.fetch(wttpUrl);
  console.log(`[WTTP] Response status: ${response.status}`);
  return response;
}

/**
 * Transform HTML content by adding base tag and replacing wttp:// URLs
 */
function transformHTMLContent(content, baseUrl) {
  let transformed = content;
  
  // Add base tag to HTML head
  transformed = transformed.replace(
    /<head[^>]*>/i,
    `$&<base href="${baseUrl}">`
  );
  
  // Replace wttp:// URLs with default bridge
  transformed = transformed.replace(/wttp:\/\//g, DEFAULT_BRIDGE_URL);
  
  return transformed;
}

/**
 * Send WTTP response to client
 */
async function sendWTTPResponse(res, response, req) {
  // Set status code
  res.status(response.status);
  
  // Pass through headers from WTTP response
  if (response.headers && typeof response.headers.forEach === 'function') {
    response.headers.forEach((value, key) => {
      // Sanitize Content-Type header
      if (key.toLowerCase() === 'content-type') {
        value = value.replace(/;\s*charset=\s*$/i, '');
        value = value.replace(/;\s*charset=;/gi, ';');
      }
      res.setHeader(key, value);
    });
  }
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  
  const contentType = res.getHeader('Content-Type') || '';
  console.log(`[WTTP] Content type: ${contentType}`);
  
  // For HTML content, get as text and transform
  if (contentType.includes('text/html')) {
    const content = await response.text();
    let baseUrl;
    if (isBridgeDomain(req.hostname)) {
      const pathParts = req.path.split('/').filter(p => p);
      const wttpSite = pathParts[0];
      baseUrl = `/${wttpSite}/`;
    } else {
      baseUrl = `/`;
    }
    
    const transformedContent = transformHTMLContent(content, baseUrl);
    res.send(transformedContent);
  } 
  // For binary content (images, etc.), get as buffer
  else if (contentType.includes('image/') || contentType.includes('application/octet-stream') || contentType.includes('video/') || contentType.includes('audio/')) {
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  }
  // For other text content
  else {
    const content = await response.text();
    res.send(content);
  }
}

/**
 * Send 404 error page
 */
function send404(res, message = 'Resource not found') {
  res.status(404).json({
    error: '404 Not Found',
    message: message,
    timestamp: new Date().toISOString()
  });
}

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

/**
 * Handle requests for custom domains
 */
async function handleCustomDomainRequest(req, res) {
  const hostname = req.hostname;
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  
  console.log(`[Custom Domain] Handling request for: ${hostname}${path}`);
  
  const wttpUrl = await buildCustomDomainWTTPUrl(hostname, path);
  const response = await fetchWTTPContent(wttpUrl);
  
  if (response.status === 404) {
    send404(res, `Resource not found at ${wttpUrl}`);
    return;
  }
  
  await sendWTTPResponse(res, response, req);
}

/**
 * Handle requests for bridge domains
 */
async function handleBridgeDomainRequest(req, res) {
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  const firstSegment = getFirstPathSegment(path);
  
  console.log(`[Bridge Domain] Handling request for path: ${path}`);
  console.log(`[Bridge Domain] First segment: ${firstSegment}`);
  
  // Check if first segment is a contract or ENS address
  if (!firstSegment || !isContractOrENSAddress(firstSegment)) {
    console.log(`[Bridge Domain] First segment is not a contract/ENS address`);
    
    // Try to prepend contract/ENS from referer
    const referer = req.get('referer');
    if (referer) {
      const refererFirstSegment = getFirstPathSegment(referer);
      if (refererFirstSegment && isContractOrENSAddress(refererFirstSegment)) {
        console.log(`[Bridge Domain] Prepending ${refererFirstSegment} from referer`);
        const newPath = `/${refererFirstSegment}${path}`;
        
        // Modify the request object to reflect the new path
        req.url = newPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
        req.path = newPath;
        
        console.log(`[Bridge Domain] Modified request path to: ${req.path}`);
      } else {
        console.log(`[Bridge Domain] Referer does not contain contract/ENS address`);
        send404(res, 'Invalid path: must start with Ethereum address or ENS name');
        return;
      }
    } else {
      console.log(`[Bridge Domain] No referer available`);
      send404(res, 'Invalid path: must start with Ethereum address or ENS name');
      return;
    }
  }
  
  // Try to fetch the resource
  const wttpUrl = buildBridgeDomainWTTPUrl(req.path);
  let response = await fetchWTTPContent(wttpUrl);
  
  // If 404, try fallback with referer (for cases like nested paths)
  if (response.status === 404) {
    console.log(`[Bridge Domain] Got 404, attempting fallback with referer`);
    const referer = req.get('referer');
    
    if (referer) {
      console.log(`[Bridge Domain] Referer: ${referer}`);
      const fallbackUrl = buildFallbackWTTPUrl(req.path, referer);
      
      if (fallbackUrl) {
        console.log(`[Bridge Domain] Trying fallback URL: ${fallbackUrl}`);
        response = await fetchWTTPContent(fallbackUrl);
        
        if (response.status === 404) {
          console.log(`[Bridge Domain] Fallback also returned 404`);
          send404(res, `Resource not found at ${wttpUrl} or ${fallbackUrl}`);
          return;
        }
      } else {
        send404(res, `Resource not found at ${wttpUrl}`);
        return;
      }
    } else {
      console.log(`[Bridge Domain] No referer available for fallback`);
      send404(res, `Resource not found at ${wttpUrl}`);
      return;
    }
  }
  
  await sendWTTPResponse(res, response, req);
}

// ============================================================================
// EXPRESS MIDDLEWARE & ROUTES
// ============================================================================

// Request logging middleware
app.use((req, res, next) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.protocol}://${req.get('host')}${req.url}`);
  console.log(`[Request] Referer: ${req.get('referer') || 'none'}`);
  next();
});

// Health check endpoint for root on bridge domains
app.get('/', async (req, res, next) => {
  const hostname = req.hostname;
  
  // If it's a custom domain, treat it as a WTTP request
  if (!isBridgeDomain(hostname)) {
    return next();
  }
  
  // Show status page for bridge domains
  res.json({
    status: 'WTTP Bridge Server Running',
    version: '2.0.0',
    hostname: hostname,
    usage: {
      bridgeDomains: 'http://wttp.page/{contract-or-ens}/{path} or http://wttp.link/{contract-or-ens}/{path}',
      customDomain: 'http://your-domain.com/{path} -> wttp://{txt-record}/{path}',
      examples: [
        'http://localhost:3000/wordl3.eth/',
        'http://wttp.page/wordl3.eth/',
        'http://wttp.link/0x1234567890123456789012345678901234567890/index.html'
      ]
    },
    bridgeDomains: BRIDGE_DOMAINS
  });
});

// Main request handler
app.use(async (req, res) => {
  try {
    const hostname = req.hostname;
    
    if (isBridgeDomain(hostname)) {
      await handleBridgeDomainRequest(req, res);
    } else {
      await handleCustomDomainRequest(req, res);
    }
    
    console.log(`[Success] Request completed`);
    
  } catch (error) {
    console.error(`[ERROR] ${error?.message || error}`);
    console.error(`[ERROR] Stack:`, error?.stack);
    
    // Map errors to HTTP status codes
    let statusCode = 500;
    let errorMessage = error?.message || 'Unknown error';
    
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      statusCode = 404;
      errorMessage = 'Resource not found';
    } else if (errorMessage.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'Request timeout';
    }
    
    res.status(statusCode).json({
      error: errorMessage,
      details: error?.message || String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`WTTP Bridge Server v2.0.0`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Server running on: http://localhost:${port}`);
  console.log(`\nBridge Domain Usage (path-based):`);
  console.log(`  http://localhost:${port}/wordl3.eth/`);
  console.log(`  http://wttp.page/minesweep.eth/`);
  console.log(`  http://wttp.link/0x1234.../index.html`);
  console.log(`\nCustom Domain Usage (TXT record-based):`);
  console.log(`  Configure DNS TXT record for: wttp.your-custom-domain.com`);
  console.log(`  TXT record format: "v=wttp3; a=wordl3.eth; chain=11155111;"`);
  console.log(`  Access: http://your-custom-domain.com/`);
  console.log(`\nBridge domains:`, BRIDGE_DOMAINS);
  console.log(`${'='.repeat(80)}\n`);
});

module.exports = app;

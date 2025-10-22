const express = require('express');
const dns = require('dns').promises;
const { WTTPHandler } = require('@wttp/handler');

const app = express();
const port = process.env.PORT || 3000;

// Initialize WTTP handler
const wttp = new WTTPHandler(undefined, "polygon");

// Bridge domains that use path-based routing (everything after / becomes wttp://)
const BRIDGE_DOMAINS = ['wttp.link', 'wttp.page', 'localhost', '127.0.0.1'];
const DEFAULT_BRIDGE_URL = 'https://wttp.page/';
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
    console.log(`[DNS] Found ${records.length} TXT record(s):`, records);
    
    // Look for a WTTP-formatted record
    for (const record of records) {
      const txtValue = Array.isArray(record) ? record.join('') : record;
      console.log(`[DNS] Checking record: ${txtValue}`);
      
      // Check if it's a WTTP record (v=wttp3)
      if (!txtValue.includes('v=wttp3')) {
        continue;
      }
      
      // Parse the structured format: v=wttp; a=address; chain=chainId;
      const parsed = {};
      const parts = txtValue.split(';').map(s => s.trim()).filter(s => s);
      
      for (const part of parts) {
        const [key, value] = part.split('=').map(s => s.trim());
        if (key && value) {
          parsed[key] = value;
        }
      }
      
      console.log(`[DNS] Parsed TXT record:`, parsed);
      
      // Must have version and address
      if (parsed.v === 'wttp3' && parsed.a) {
        return {
          address: parsed.a,
          chain: parsed.chain || null
        };
      }
    }
    
    console.log(`[DNS] No valid WTTP TXT record found`);
    return null;
  } catch (error) {
    console.log(`[DNS] Error looking up TXT records for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Determine if the hostname is a bridge domain (uses path-based routing)
 * If not a bridge domain, it's a custom domain that needs TXT lookup
 */
function isBridgeDomain(hostname) {
  // Check if hostname matches or ends with any of our bridge domains
  return BRIDGE_DOMAINS.some(domain => 
    hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

/**
 * Build the WTTP URL based on the request hostname and path
 */
async function buildWTTPUrl(req) {
  const hostname = req.hostname;
  const path = req.path.startsWith('/') ? req.path : `/${req.path}`;
  
  console.log(`[URL Builder] Hostname: ${hostname}`);
  console.log(`[URL Builder] Path: ${path}`);
  console.log(`[URL Builder] Full URL: ${req.protocol}://${req.get('host')}${req.path}`);
  
  if (isBridgeDomain(hostname)) {
    // For bridge domains (wttp.page, wttp.link, localhost), path becomes the full WTTP URL
    // Remove leading slash and convert to wttp://
    const wttpPath = path.substring(1);
    const wttpUrl = `wttp://${wttpPath}`;
    console.log(`[URL Builder] Bridge domain, built WTTP URL: ${wttpUrl}`);
    return wttpUrl;
  } else {
    // For custom domains, look up TXT record
    console.log(`[URL Builder] Custom domain detected, looking up TXT record...`);
    
    const txtRecord = await lookupTXTRecord(hostname);
    if (txtRecord) {
      // Build WTTP URL using TXT record: wttp://address:chain/path or wttp://address/path
      let wttpUrl;
      if (txtRecord.chain) {
        wttpUrl = `wttp://${txtRecord.address}:${txtRecord.chain}${path}`;
      } else {
        wttpUrl = `wttp://${txtRecord.address}${path}`;
      }
      console.log(`[URL Builder] Built WTTP URL from TXT: ${wttpUrl} (address: ${txtRecord.address}, chain: ${txtRecord.chain || 'default'})`);
      return wttpUrl;
    } else {
      console.log(`[URL Builder] No valid WTTP TXT record found, using hostname directly`);
      const wttpUrl = `wttp://${hostname}${path}`;
      return wttpUrl;
    }
  }
}

// Middleware to log all incoming requests
app.use((req, res, next) => {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.protocol}://${req.get('host')}${req.url}`);
  console.log(`[Request] Headers:`, {
    host: req.get('host'),
    'user-agent': req.get('user-agent'),
    'accept': req.get('accept'),
    'referer': req.get('referer')
  });
  next();
});

// Health check endpoint for root on bridge domains
app.get('/', async (req, res, next) => {
  const hostname = req.hostname;
  
  // If it's a custom domain (not a bridge domain), treat it as a WTTP request
  if (!isBridgeDomain(hostname)) {
    console.log(`[Root] Custom domain detected, proceeding to WTTP handler`);
    return next();
  }
  
  // Otherwise show the status page
  console.log(`[Root] Bridge domain, showing status page`);
  res.json({
    status: 'WTTP Bridge Server Running',
    version: '1.0.0',
    hostname: hostname,
    usage: {
      bridgeDomains: 'http://wttp.page/{wttp-path} or http://wttp.link/{wttp-path} -> wttp://{wttp-path}',
      customDomain: 'http://your-domain.com/{path} -> wttp://{txt-record}/{path}',
      examples: [
        'http://localhost:3000/wordl3.eth/',
        'http://wttp.page/wordl3.eth/',
        'http://wttp.link/minesweep.eth/',
        'http://custom-domain.com/ (with TXT record)'
      ]
    },
    bridgeDomains: BRIDGE_DOMAINS
  });
});

// Main WTTP bridge handler - handles ALL requests
app.use(async (req, res) => {
  try {
    console.log(`[Bridge] Processing request...`);
    
    // Build the WTTP URL based on hostname and path
    const wttpUrl = await buildWTTPUrl(req);
    
    console.log(`[WTTP] Fetching: ${wttpUrl}`);
    
    // Fetch content from WTTP
    const response = await wttp.fetch(wttpUrl);
    
    console.log(`[WTTP] Response received:`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Headers type:`, response.headers.constructor.name);
    
    // Set status code
    res.status(response.status);
    
    // Pass through headers from WTTP response
    // Headers object from Fetch API requires .forEach() method
    if (response.headers && typeof response.headers.forEach === 'function') {
      response.headers.forEach((value, key) => {
        // Sanitize Content-Type header - WTTP sometimes returns malformed charset
        if (key.toLowerCase() === 'content-type') {
          // Remove trailing "; charset=" with no value
          value = value.replace(/;\s*charset=\s*$/i, '');
          // If still has charset but no value, remove it
          value = value.replace(/;\s*charset=;/gi, ';');
          console.log(`  Setting header (sanitized): ${key} = ${value}`);
        } else {
          console.log(`  Setting header: ${key} = ${value}`);
        }
        res.setHeader(key, value);
      });
    }
    
    // Add CORS headers for web applications
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    
    const finalContentType = res.getHeader('Content-Type');
    console.log(`[Response] Final Content-Type being sent:`, finalContentType);
    
    // Get response body
    const content = await response.text();
    
    console.log(`[WTTP] Content received:`);
    console.log(`  Type: ${typeof content}`);
    console.log(`  Length: ${content.length} bytes`);
    if (content.length > 0 && content.length < 5000) {
      console.log(`  First 500 chars: ${content.substring(0, 500)}...`);
    } else {
      console.log(`  First 200 chars: ${content.substring(0, 200)}...`);
    }
    
    // Transform content based on type
    const contentType = res.getHeader('Content-Type') || '';
    console.log(`[Transform] Checking content type: ${contentType}`);
    
    if (typeof content === 'string') {
      let transformedContent = content;
      
      // Check if this is HTML content
      if (contentType.includes('text/html')) {
        console.log(`[Transform] HTML content detected, adding base tag and replacing wttp:// URLs`);
        
        // Build the base URL for this request
        let baseUrl;
        if (isBridgeDomain(req.hostname)) {
          // For bridge domains, include WTTP site context
          const pathParts = req.path.split('/').filter(p => p);
          const wttpSite = pathParts[0];
          baseUrl = `/${wttpSite}/`;
        } else {
          // For custom domains, use domain as base
          baseUrl = `/`;
        }
        
        console.log(`[Transform] Base URL: ${baseUrl}`);
        
        // Add base tag to HTML head
        transformedContent = transformedContent.replace(
          /<head[^>]*>/i,
          `$&<base href="${baseUrl}">`
        );

      }
        
      // Replace wttp:// URLs with default bridge
      transformedContent = transformedContent.replace(/wttp:\/\//g, DEFAULT_BRIDGE_URL);
      console.log(`[Transform] HTML transformation completed`);
      
      res.send(transformedContent);
    } else {
      res.send(content);
    }
    
    console.log(`[Bridge] Request completed successfully`);
    
  } catch (error) {
    console.error(`[ERROR] ${error?.message || error}`);
    console.error(`[ERROR] Stack:`, error?.stack);
    
    // Map errors to HTTP status codes
    let statusCode = 500;
    let errorMessage = error?.message || 'Unknown error';
    
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      statusCode = 404;
      errorMessage = 'WTTP resource not found';
    } else if (errorMessage.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'WTTP request timeout';
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
  console.log(`WTTP Bridge Server v1.0.0`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Server running on: http://localhost:${port}`);
  console.log(`\nBridge Domain Usage (path-based):`);
  console.log(`  http://localhost:${port}/wordl3.eth/`);
  console.log(`  http://wttp.page/minesweep.eth/`);
  console.log(`  http://wttp.link/etherdoom.eth/`);
  console.log(`\nCustom Domain Usage (TXT record-based):`);
  console.log(`  Configure DNS TXT record for: wttp.your-custom-domain.com`);
  console.log(`  TXT record format: "v=wttp3; a=wordl3.eth; chain=11155111;"`);
  console.log(`  Access: http://your-custom-domain.com/`);
  console.log(`\nBridge domains (path-based):`, BRIDGE_DOMAINS);
  console.log(`All other domains use TXT record lookup`);
  console.log(`${'='.repeat(80)}\n`);
});

module.exports = app;

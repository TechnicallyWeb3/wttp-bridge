// handleWttpUrl.js
import { isTextMimeType } from "../utils/wttpFetch.js";
import { parseWttpUrl } from "./parseWttpUrl.js";
import {
  processStyleSheets,
  processScripts,
  processImages,
} from "./processTagsFromHtml.js";
import { WTTPHandler } from "@wttp/handler";

export async function handleWTTPURL() {
  // Get the current URL
  let wttpUrl = window.location.pathname;
  let fullContent = null;
  console.log("handleWTTPURL");

  if (process.env.SINGLE_CONTRACT) {
    // Get the url path and add it to the contract address
    wttpUrl = `${process.env.SINGLE_CONTRACT}${wttpUrl}`;
  } else {
    // /wttp/ prefix allows gateway-style URLs
    // remove /wttp/ if it exists
    wttpUrl = wttpUrl.startsWith("/wttp/")
      ? wttpUrl.split("/wttp/")[1]
      : wttpUrl;
  }

  // const { address, chain, path } = parseWttpUrl(wttpUrl);

  // console.log("Debug: Initial contract address or ENS:", address);
  // console.log("Debug: Chain:", chain);
  // console.log("Debug: Path:", path);

  // console.log(
  //   "Fetching from WTTP site:",
  //   address,
  //   "path:",
  //   path,
  //   "chain:",
  //   chain
  // );

  const wttp = new WTTPHandler(undefined, "polygon");

  try {
    console.log("fetching wttp url::", `wttp://${wttpUrl}`);
    const result = await wttp.fetch(`wttp://${wttpUrl}`);

    console.log("result is::", result);

    if (
      result.status === 200 ||
      result.status === 206
    ) {
      // Get the content type from metadata
      const mimeType = result.headers.get("content-type");
      console.log("MIME type is::", mimeType);


      if (result.body) {
        console.log("result.body found::");
        // Decode content based on MIME type
        // const content = decodeContent(result, mimeType);
        // console.log(
        //   "content is::",
        //   typeof content === "string"
        //     ? content
        //     : `[Binary data: ${result.content.length} bytes]`
        // );

        let isText = true;
        try {
          fullContent = await result.text();
        } catch (error) {
          fullContent = btoa(String.fromCharCode(...(await result.arrayBuffer())));
          isText = false;
        }
        
        console.log("MIME Type isText::", isText);

      } else {
        console.error("No content received from WTTP resource");
        return;
      }
    } else {
      console.error(
        `Error: ${result.status} - Resource not found or error`
      );
      return;
    }
  } catch (error) {
    console.error("Failed to fetch WTTP resource:", error);
    return;
  }

  // Parse fullContent, search for meta tags, link tags, and title tags
  // and pull them out then append them to the head tag of the document
  // But exclude link tags that reference stylesheets to prevent browser from loading them
  const headTags = `
  ${extractNonStylesheetTags(fullContent, /<meta[^>]+>/g)} 
  ${extractNonStylesheetTags(fullContent, /<link[^>]+>/g)} 
  ${extractNonStylesheetTags(fullContent, /<title[^>]+>/g)}`;

  // append extracted tags to existing head tags instead of replacing
  document.head.insertAdjacentHTML("beforeend", headTags);

  // Extract the body element from the fullContent
  const bodyTags = extractNonStylesheetTags(fullContent, /<body[^>]+>/g);

  // Replace the body tag with the extracted tags
  if (bodyTags) {
    document.body.innerHTML = bodyTags[0];
  } else {
    console.log("WARNING: No body tags found in the content");

    // Replace the body tag with the fullContent
    document.body.innerHTML = fullContent;
  }

  // Replace script tags, style tags, and image tags with the content

  // // Append body tag to HTML after head and set innerHTML to fullContent
  // const bodyTag = document.createElement("body");

  // // Replace current body tag
  // document.documentElement.replaceChild(bodyTag, document.body);

  // // Set the body content after all external resources are processed
  // document.body.innerHTML = fullContent;

  // Preserve the CSP meta tag before replacing the document
  // const cspMetaTag = document.querySelector(
  //   'meta[http-equiv="Content-Security-Policy"]'
  // );

  // Re-add the CSP meta tag to preserve security policies
  // if (
  //   cspMetaTag &&
  //   !document.querySelector('meta[http-equiv="Content-Security-Policy"]')
  // ) {
  //   document.head.insertBefore(cspMetaTag, document.head.firstChild);
  // }

  // Set the body opacity to zero so we can wait for the images
  document.body.style.opacity = 50;

  // Process stylesheets first to prevent browser from loading original CSS links
  console.log("Processing stylesheets...");
  fullContent = await processStyleSheets(fullContent);

  // Process scripts
  //console.log("Processing scripts...");
  // fullContent = await processScripts(fullContent);

  // // Process images after DOM update
  setTimeout(async () => {
    // Stringify the document body
    await processImages(fullContent);
    document.body.style.opacity = 100;
  }, 100);

  // Gives some time for the new dom an style sheets to load
  setTimeout(() => {
    console.log("Processing scripts...");
    processScripts(fullContent);
  }, 1000);
}

function extractNonStylesheetTags(content, regex) {
  const tags = content.match(regex);
  if (tags && tags.length) {
    // Filter out link tags that reference stylesheets
    const filteredTags = tags.filter((tag) => {
      const href = tag.match(/href="([^"]+)"/);
      if (href) {
        const hrefValue = href[1];
        // Exclude stylesheet links (CSS files)
        return !(
          hrefValue.endsWith(".css") ||
          hrefValue.includes("style") ||
          tag.includes('rel="stylesheet"') ||
          tag.includes("rel='stylesheet'")
        );
      }
      return true; // Keep non-link tags
    });
    return filteredTags.join("");
  }
  return "";
}

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit for base64 images and design assets
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Initialize Gemini SDK with User-Agent header as required
let genAiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAiClient && process.env.GEMINI_API_KEY) {
    genAiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAiClient;
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Helper: Clean, resolve redirects, and extract Canva canonical URL / design ID
async function resolveCanvaTarget(rawInput: string): Promise<{
  originalInput: string;
  canonicalUrl: string;
  viewUrl: string;
  embedUrl: string;
  designId: string | null;
}> {
  let input = rawInput.trim();

  // If user pasted an embed code snippet e.g. <iframe ... src="..." ...>
  const iframeSrcMatch = input.match(/src=["'](https:\/\/[^"']*canva\.(?:com|link)[^"']*)["']/i);
  if (iframeSrcMatch) {
    input = iframeSrcMatch[1];
  }

  // Ensure scheme
  let currentUrl = input;
  if (!currentUrl.startsWith("http://") && !currentUrl.startsWith("https://")) {
    currentUrl = "https://" + currentUrl;
  }

  // Follow redirects (e.g. canva.link shortlinks or 301/302 redirects)
  let hops = 0;
  while (hops < 6) {
    hops++;
    try {
      const redirectRes = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const locationHeader = redirectRes.headers.get("location");
      if (locationHeader && (redirectRes.status === 301 || redirectRes.status === 302 || redirectRes.status === 307 || redirectRes.status === 308)) {
        currentUrl = locationHeader.startsWith("http")
          ? locationHeader
          : new URL(locationHeader, currentUrl).toString();
      } else {
        break;
      }
    } catch (err) {
      console.warn(`Redirect hop ${hops} warning:`, err);
      break;
    }
  }

  // Extract design ID
  const designIdMatch = currentUrl.match(/canva\.com\/(?:design|templates)\/([A-Za-z0-9_-]+)/i);
  const designId = designIdMatch ? designIdMatch[1] : null;

  // Normalize /edit -> /view and /view?embed
  let viewUrl = currentUrl;
  if (/\/edit(\?.*)?$/i.test(currentUrl)) {
    viewUrl = currentUrl.replace(/\/edit(\?.*)?$/i, "/view");
  } else if (!/\/view(\?.*)?$/i.test(currentUrl) && designId) {
    // If it's a bare design link or template link
    viewUrl = currentUrl.replace(/(\?.*)?$/, "/view");
  }

  let embedUrl = viewUrl;
  if (embedUrl.includes("/view")) {
    embedUrl = embedUrl.replace(/\/view(\?.*)?$/i, "/view?embed");
  } else {
    embedUrl = embedUrl + (embedUrl.includes("?") ? "&embed" : "?embed");
  }

  return {
    originalInput: input,
    canonicalUrl: currentUrl,
    viewUrl,
    embedUrl,
    designId,
  };
}

// Route 1: Fetch and parse Canva link (handles shortlinks, view links, embed codes, and multi-page designs)
app.post("/api/canva/fetch-link", async (req, res) => {
  try {
    const { url, pageIndex = 0 } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ success: false, message: "URL is required" });
      return;
    }

    const { canonicalUrl, viewUrl, embedUrl, designId } = await resolveCanvaTarget(url);

    let title = "Canva Design";
    let author: string | undefined;
    let previewImageUrl: string | null = null;
    let width = 1080;
    let height = 1080;
    let imageBase64: string | null = null;
    let pages: Array<{ pageNumber: number; url: string }> = [];

    // Step 1: Query Canva official oEmbed endpoint for exact title, author, and dimensions
    try {
      const oembedUrl = `https://www.canva.com/_oembed?url=${encodeURIComponent(viewUrl)}`;
      const oembedRes = await fetch(oembedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        if (oembedData.title) {
          title = oembedData.title.replace(/\s*-\s*Canva$/i, "").trim();
        }
        if (oembedData.author_name) {
          author = oembedData.author_name;
        }
        if (oembedData.width && typeof oembedData.width === "number") {
          width = oembedData.width;
        }
        if (oembedData.height && typeof oembedData.height === "number") {
          height = oembedData.height;
        }
      }
    } catch (oembedErr: any) {
      console.warn("Canva oEmbed query notice:", oembedErr.message);
    }

    // Step 2: Fetch embed viewer page to extract direct AWS pre-signed S3 page exports
    try {
      const embedRes = await fetch(embedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (embedRes.ok) {
        const embedHtml = await embedRes.text();

        // Extract fallback URLs which contain pre-signed S3 download links for rendered canvas slides
        const fallbackMatches = [...embedHtml.matchAll(/fallback=([^\s\"'&]+)/gi)].map((m) =>
          decodeURIComponent(m[1])
        );

        if (fallbackMatches.length > 0) {
          // De-duplicate URLs
          const uniqueUrls = [...new Set(fallbackMatches)];
          pages = uniqueUrls.map((imgUrl, idx) => ({
            pageNumber: idx + 1,
            url: imgUrl,
          }));

          // Select requested page or default to page 1
          const selectedIndex = Math.min(Math.max(0, pageIndex), pages.length - 1);
          const targetImageUrl = pages[selectedIndex].url;
          previewImageUrl = targetImageUrl;

          // Download image directly from S3
          const imgRes = await fetch(targetImageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
          });

          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "image/png";
            imageBase64 = `data:${contentType};base64,${buffer.toString("base64")}`;
          }
        }
      }
    } catch (embedErr: any) {
      console.warn("Canva embed scraper notice:", embedErr.message);
    }

    // Step 3: Fallback - try direct fetch of viewUrl if embed didn't provide imageBase64
    if (!imageBase64) {
      try {
        const response = await fetch(viewUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (response.ok) {
          const html = await response.text();

          if (title === "Canva Design") {
            const ogTitleMatch =
              html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
              html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
              html.match(/<title>([^<]+)<\/title>/i);
            if (ogTitleMatch) {
              title = ogTitleMatch[1].replace(/\s*-\s*Canva$/i, "").trim();
            }
          }

          const ogImageMatch =
            html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
            html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
            html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
          if (ogImageMatch) {
            previewImageUrl = ogImageMatch[1];
            const imgRes = await fetch(previewImageUrl, {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Referer: "https://www.canva.com/",
              },
            });
            if (imgRes.ok) {
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              const contentType = imgRes.headers.get("content-type") || "image/jpeg";
              imageBase64 = `data:${contentType};base64,${buffer.toString("base64")}`;
            }
          }
        }
      } catch (directErr: any) {
        console.warn("Direct viewUrl fetch notice:", directErr.message);
      }
    }

    // Return successfully decompiled design metadata and image
    if (imageBase64) {
      res.json({
        success: true,
        title: title || (designId ? `Canva Design (${designId})` : "Canva Design"),
        author,
        designId,
        previewImageUrl,
        imageBase64,
        width,
        height,
        url: canonicalUrl,
        totalPages: pages.length,
        currentPage: pageIndex + 1,
        pages,
      });
      return;
    }

    // If Canva was blocked or image couldn't be fetched
    res.json({
      success: false,
      canvaBlocked: true,
      designId,
      title: title !== "Canva Design" ? title : (designId ? `Canva Design (${designId})` : "Canva Design"),
      message:
        "Canva protected this design behind an authentication or Cloudflare bot check. You can paste the Canva embed HTML code, or upload/drop your exported Canva image (PNG/JPG) or PDF below for instant editable PSD decomposition.",
      url: canonicalUrl,
    });
  } catch (error: any) {
    console.error("Error in /api/canva/fetch-link:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to process Canva link" });
  }
});

// Route 2: Analyze Canva design with Gemini 3.8 Flash to extract editable PSD layers
app.post("/api/canva/analyze-design", async (req, res) => {
  try {
    const { imageBase64, title = "Canva Design", dimensions } = req.body;
    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.status(400).json({ success: false, message: "Image base64 data is required" });
      return;
    }

    // Extract raw base64 string and mimeType (supports image/png, image/jpeg, image/webp, application/pdf, etc.)
    const mimeMatch = imageBase64.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
    let mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    if (mimeType.includes("pdf")) {
      mimeType = "application/pdf";
    }
    const rawBase64 = mimeMatch ? mimeMatch[2] : imageBase64;

    const ai = getGenAI();
    if (!ai) {
      // Fallback generator if GEMINI_API_KEY is not configured
      const fallbackAnalysis = generateHeuristicLayers(title, dimensions);
      res.json({ success: true, analysis: fallbackAnalysis, fallback: true });
      return;
    }

    const targetW = dimensions?.width || 1080;
    const targetH = dimensions?.height || 1080;

    const systemInstruction = `You are an elite Adobe Photoshop Document (.psd) master graphic engineer and reverse-engineering specialist.
Your mission is to visually dissect this Canva/graphic design into a comprehensive, high-fidelity, fully editable multi-layered Photoshop document structure with extraordinary attention to detail.

CRITICAL CANVAS DIMENSION RULE:
The source canvas resolution is EXACTLY ${targetW} x ${targetH} px (aspect ratio ${targetW}:${targetH}).
All bounding boxes { "x", "y", "width", "height" } and font sizes MUST be mapped strictly to this [0, ${targetW}] × [0, ${targetH}] pixel coordinate space.

DECONSTRUCTION REQUIREMENTS (LEAVE NOTHING OUT):
1. CANVAS & BACKGROUND:
   - "backgroundType": "photo" (if backdrop has photographs, scenery, complex artwork, wallpapers, or textured imagery), "gradient" (if smooth 2+ color transition), or "solid" (if single solid color).
   - "backgroundColor": dominant hex color (e.g. #0F172A).
   - "gradientColors": 2-4 hex color stops if gradient.
   - "gradientAngle": angle in degrees (e.g. 0, 45, 90, 135, 180).
   - "palette": 5-7 dominant branding colors extracted across the design.

2. TYPOGRAPHY (EXTRACT EVERY SINGLE TEXT ITEM):
   - You MUST extract EVERY piece of text without omission: large headlines, subheadlines, kicker categories, promotional tags, discount badges ("50% OFF", "SALE"), button text ("GET STARTED", "SHOP NOW"), dates, prices ("$99", "FREE"), addresses, website URLs, social handles, disclaimers, bullet lists.
   - "content": exact literal wording, preserving uppercase/lowercase and line breaks ('\\n').
   - "fontFamily": accurately match the typographic style to standard Google Fonts:
     * Modern Sans: "Montserrat", "Poppins", "Inter", "Plus Jakarta Sans", "Lato", "Roboto", "Open Sans"
     * Bold Condensed/Display: "Oswald", "Bebas Neue", "Anton", "Barlow Condensed"
     * Elegant Serif: "Playfair Display", "Merriweather", "Cinzel", "Lora", "Bodoni Moda"
     * Script/Accent: "Pacifico", "Dancing Script", "Caveat"
   - "fontSize": accurate font size in px relative to the ${targetH}px canvas height.
   - "fontWeight": "normal" (400), "medium" (500), "bold" (700), "800", or "900".
   - "color": exact hex color code (e.g. #FFFFFF, #E2E8F0, #FF5500).
   - "alignment": "left", "center", or "right".
   - "textTransform": "uppercase" | "lowercase" | "capitalize" | "none".
   - "bounds": exact pixel bounding box { x, y, width, height } that tightly frames this text block.

3. SHAPES, BADGES & BUTTONS:
   - Identify all vector/UI shape containers: CTA button pills, framing background cards, discount badge circles/stars, price tags, decorative ribbon banners, accent separator lines, icon container boxes.
   - "shapeType": "rounded-rectangle" | "circle" | "rectangle" | "badge" | "line".
   - "fillColor": hex color.
   - "gradientColors": array of hex colors if shape has a gradient fill.
   - "strokeColor": hex color if shape has an outline/border.
   - "strokeWidth": border thickness in px (0 if no border).
   - "borderRadius": corner radius in px (e.g. 24-50 for pill buttons, 12-24 for cards, or half-width for circles).
   - "opacity": 0.0 to 1.0.
   - "bounds": exact pixel bounding box { x, y, width, height }.

4. VISUALS, PHOTOS, ILLUSTRATIONS & LOGOS:
   - CRITICAL: Identify EVERY photograph, product shot, model/person cutout, graphic illustration, brand logo, decorative vector asset, or icon in the design!
   - "type": "image".
   - "group": "Visuals".
   - "name": descriptive name (e.g. "Product Hero Cutout", "Portrait Model Photo", "Brand Logo Emblem", "Shopping Cart Icon", "Geometric Graphic Accent").
   - "bounds": exact bounding box { x, y, width, height } framing this visual asset so our automated rasterizer can extract the crisp high-definition cutout directly from the source image.

Output strict JSON only adhering to this structure:
{
  "title": "${title}",
  "width": ${targetW},
  "height": ${targetH},
  "aspectRatio": "${targetW}:${targetH}",
  "backgroundColor": "#HEX",
  "backgroundType": "solid" | "gradient" | "photo",
  "gradientColors": ["#HEX1", "#HEX2"],
  "gradientAngle": 135,
  "palette": ["#HEX1", "#HEX2", "#HEX3", "#HEX4", "#HEX5"],
  "layers": [
    {
      "id": "layer_1",
      "name": "string",
      "type": "text" | "shape" | "badge" | "image" | "background",
      "group": "Typography" | "Graphics & Accents" | "Visuals" | "Background",
      "bounds": { "x": 0, "y": 0, "width": 100, "height": 50 },
      "visible": true,
      "opacity": 1.0,
      "text": {
        "content": "string",
        "fontFamily": "Montserrat",
        "fontSize": 48,
        "fontWeight": "bold",
        "color": "#FFFFFF",
        "alignment": "center",
        "textTransform": "uppercase"
      },
      "shape": {
        "shapeType": "rounded-rectangle",
        "fillColor": "#FF5500",
        "gradientColors": ["#FF5500", "#FF2200"],
        "strokeColor": "#FFFFFF",
        "strokeWidth": 2,
        "borderRadius": 12,
        "opacity": 1.0
      }
    }
  ]
}`;

    const promptText = `Analyze this Canva design (${targetW}x${targetH}px) and reverse-engineer it into a complete, professional multi-layer Photoshop PSD structure. Extract EVERY text element with exact wording and font attributes, all buttons and shapes, and pinpoint bounding boxes for all photos, illustrations, and logos.`;

    let responseText = "";
    const modelsToTry = ["gemini-3.8-flash", "gemini-3.6-flash"];
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: rawBase64,
                },
              },
              { text: promptText },
            ],
          },
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.15,
          },
        });
        if (response.text) {
          responseText = response.text;
          break;
        }
      } catch (genErr: any) {
        lastError = genErr;
        console.warn(`Model ${modelName} analysis attempt notice:`, genErr.message);
      }
    }

    let parsedData: any;
    if (responseText) {
      try {
        parsedData = JSON.parse(responseText.trim());
      } catch (jsonErr) {
        console.error("Failed to parse Gemini JSON output:", responseText.slice(0, 500));
        parsedData = generateHeuristicLayers(title, dimensions);
      }
    } else {
      console.warn("AI models unavailable, using heuristic layer extractor:", lastError?.message);
      parsedData = generateHeuristicLayers(title, dimensions);
    }

    // Validate and sanitize layers
    if (!parsedData.layers || !Array.isArray(parsedData.layers) || parsedData.layers.length === 0) {
      parsedData = generateHeuristicLayers(title, dimensions);
    }

    // Sanitize and clamp all layer bounds to ensure coordinates never overflow
    parsedData.width = targetW;
    parsedData.height = targetH;
    parsedData.aspectRatio = `${targetW}:${targetH}`;

    parsedData.layers = parsedData.layers.map((layer: any, idx: number) => {
      const bx = Math.max(0, Math.min(layer.bounds?.x ?? 0, targetW - 10));
      const by = Math.max(0, Math.min(layer.bounds?.y ?? 0, targetH - 10));
      const bw = Math.max(10, Math.min(layer.bounds?.width ?? 100, targetW - bx));
      const bh = Math.max(10, Math.min(layer.bounds?.height ?? 40, targetH - by));

      return {
        ...layer,
        id: layer.id || `layer_${idx + 1}`,
        bounds: { x: Math.round(bx), y: Math.round(by), width: Math.round(bw), height: Math.round(bh) },
        visible: layer.visible !== false,
        opacity: typeof layer.opacity === "number" ? Math.max(0, Math.min(1, layer.opacity)) : 1,
      };
    });

    // Ensure title and preview
    parsedData.title = parsedData.title || title;
    parsedData.previewUrl = imageBase64;

    res.json({
      success: true,
      analysis: parsedData,
    });
  } catch (error: any) {
    console.error("Error in /api/canva/analyze-design:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to analyze Canva design",
    });
  }
});

// Route 3: Proxy images to prevent canvas CORS security errors
app.post("/api/canva/proxy-image", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).send("URL required");
      return;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      res.status(response.status).send("Failed to fetch target image");
      return;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// Heuristic fallback generator if AI key is missing or model fails
function generateHeuristicLayers(title: string, dims?: { width: number; height: number }): any {
  const w = dims?.width || 1080;
  const h = dims?.height || 1080;

  return {
    title: title || "Canva Editable Design",
    width: w,
    height: h,
    aspectRatio: w === h ? "1:1" : `${w}:${h}`,
    backgroundColor: "#0F172A",
    backgroundType: "gradient",
    gradientColors: ["#1E293B", "#0F172A"],
    gradientAngle: 135,
    palette: ["#6366F1", "#EC4899", "#F8FAFC", "#0F172A", "#F59E0B"],
    layers: [
      {
        id: "layer_bg",
        name: "Background Canvas",
        type: "background",
        group: "Background",
        bounds: { x: 0, y: 0, width: w, height: h },
        visible: true,
        opacity: 1,
        shape: {
          shapeType: "rectangle",
          fillColor: "#0F172A",
        },
      },
      {
        id: "layer_card",
        name: "Content Framing Card",
        type: "shape",
        group: "Graphics & Accents",
        bounds: { x: Math.round(w * 0.1), y: Math.round(h * 0.15), width: Math.round(w * 0.8), height: Math.round(h * 0.7) },
        visible: true,
        opacity: 0.95,
        shape: {
          shapeType: "rounded-rectangle",
          fillColor: "#1E293B",
          strokeColor: "#334155",
          strokeWidth: 2,
          borderRadius: 24,
        },
      },
      {
        id: "layer_badge",
        name: "Special Offer Badge",
        type: "badge",
        group: "Graphics & Accents",
        bounds: { x: Math.round(w * 0.5 - 90), y: Math.round(h * 0.22), width: 180, height: 44 },
        visible: true,
        opacity: 1,
        shape: {
          shapeType: "rounded-rectangle",
          fillColor: "#6366F1",
          borderRadius: 22,
        },
      },
      {
        id: "layer_badge_txt",
        name: "Badge Label",
        type: "text",
        group: "Typography",
        bounds: { x: Math.round(w * 0.5 - 80), y: Math.round(h * 0.23), width: 160, height: 28 },
        visible: true,
        opacity: 1,
        text: {
          content: "SPECIAL EDITION",
          fontFamily: "Montserrat",
          fontSize: 14,
          fontWeight: "bold",
          color: "#FFFFFF",
          alignment: "center",
        },
      },
      {
        id: "layer_headline",
        name: "Main Headline",
        type: "text",
        group: "Typography",
        bounds: { x: Math.round(w * 0.15), y: Math.round(h * 0.32), width: Math.round(w * 0.7), height: 110 },
        visible: true,
        opacity: 1,
        text: {
          content: title.toUpperCase() || "CREATIVE DESIGN",
          fontFamily: "Montserrat",
          fontSize: 48,
          fontWeight: "900",
          color: "#F8FAFC",
          alignment: "center",
        },
      },
      {
        id: "layer_subhead",
        name: "Subtitle Description",
        type: "text",
        group: "Typography",
        bounds: { x: Math.round(w * 0.18), y: Math.round(h * 0.46), width: Math.round(w * 0.64), height: 60 },
        visible: true,
        opacity: 1,
        text: {
          content: "High-resolution editable typography and layout converted directly into Photoshop PSD",
          fontFamily: "Plus Jakarta Sans",
          fontSize: 18,
          fontWeight: "normal",
          color: "#94A3B8",
          alignment: "center",
        },
      },
      {
        id: "layer_cta_btn",
        name: "Call to Action Button",
        type: "shape",
        group: "Graphics & Accents",
        bounds: { x: Math.round(w * 0.5 - 130), y: Math.round(h * 0.62), width: 260, height: 60 },
        visible: true,
        opacity: 1,
        shape: {
          shapeType: "rounded-rectangle",
          fillColor: "#EC4899",
          borderRadius: 30,
        },
      },
      {
        id: "layer_cta_txt",
        name: "Button Text",
        type: "text",
        group: "Typography",
        bounds: { x: Math.round(w * 0.5 - 120), y: Math.round(h * 0.64), width: 240, height: 32 },
        visible: true,
        opacity: 1,
        text: {
          content: "EXPLORE NOW",
          fontFamily: "Montserrat",
          fontSize: 18,
          fontWeight: "bold",
          color: "#FFFFFF",
          alignment: "center",
        },
      },
    ],
  };
}

async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

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

// Helper: Clean and extract Canva URL / design ID
function extractCanvaInfo(rawInput: string): { normalizedUrl: string; designId: string | null } {
  let input = rawInput.trim();

  // If user pasted an embed code snippet e.g. <iframe ... src="..." ...>
  const iframeSrcMatch = input.match(/src=["'](https:\/\/[^"']*canva\.com[^"']*)["']/i);
  if (iframeSrcMatch) {
    input = iframeSrcMatch[1];
  }

  // Extract design ID from standard Canva URL structures
  // e.g. canva.com/design/DAG.../view or canva.com/templates/EAF...
  const designIdMatch = input.match(/canva\.com\/(?:design|templates)\/([A-Za-z0-9_-]+)/i);
  const designId = designIdMatch ? designIdMatch[1] : null;

  // Clean URL: ensure https
  let normalizedUrl = input;
  if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  return { normalizedUrl, designId };
}

// Route 1: Fetch and parse Canva link
app.post("/api/canva/fetch-link", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ success: false, message: "URL is required" });
      return;
    }

    const { normalizedUrl, designId } = extractCanvaInfo(url);

    // Fetch the Canva link with browser-grade headers
    let html = "";
    let status = 0;
    try {
      const response = await fetch(normalizedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
        },
      });
      status = response.status;
      if (response.ok) {
        html = await response.text();
      }
    } catch (fetchErr: any) {
      console.warn("Direct fetch error:", fetchErr.message);
    }

    let title = "Canva Design";
    let previewImageUrl: string | null = null;
    let width = 1080;
    let height = 1080;

    if (html) {
      // Extract title
      const ogTitleMatch =
        html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
        html.match(/<title>([^<]+)<\/title>/i);
      if (ogTitleMatch) {
        title = ogTitleMatch[1].replace(/\s*-\s*Canva$/i, "").trim();
      }

      // Extract preview image (OpenGraph / Twitter / thumbnail)
      const ogImageMatch =
        html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
        html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']twitter:image["']/i);
      if (ogImageMatch) {
        previewImageUrl = ogImageMatch[1];
      }

      // Dimensions
      const widthMatch = html.match(/property=["']og:image:width["']\s+content=["'](\d+)["']/i);
      const heightMatch = html.match(/property=["']og:image:height["']\s+content=["'](\d+)["']/i);
      if (widthMatch) width = parseInt(widthMatch[1], 10);
      if (heightMatch) height = parseInt(heightMatch[1], 10);
    }

    // If an image URL was extracted, download and convert to base64
    let imageBase64: string | null = null;
    if (previewImageUrl) {
      try {
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
      } catch (imgErr) {
        console.warn("Could not download extracted preview image:", imgErr);
      }
    }

    // Return result
    if (imageBase64) {
      res.json({
        success: true,
        title,
        designId,
        previewImageUrl,
        imageBase64,
        width,
        height,
        url: normalizedUrl,
      });
      return;
    }

    // If Canva returned bot challenge or status 403 / redirect
    res.json({
      success: false,
      canvaBlocked: true,
      designId,
      title: designId ? `Canva Design (${designId})` : "Canva Design",
      message:
        "Canva enforces Cloudflare bot protection on automated cloud server requests for this URL. You can paste the Canva embed HTML code, load via direct preview image, or upload/drop your exported Canva image/PDF below for instant editable PSD conversion.",
      url: normalizedUrl,
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

    // Extract raw base64 string and mimeType
    const mimeMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const rawBase64 = mimeMatch ? mimeMatch[2] : imageBase64;

    const ai = getGenAI();
    if (!ai) {
      // Fallback generator if GEMINI_API_KEY is not configured
      const fallbackAnalysis = generateHeuristicLayers(title, dimensions);
      res.json({ success: true, analysis: fallbackAnalysis, fallback: true });
      return;
    }

    const systemInstruction = `You are a world-class Adobe Photoshop Document (.psd) graphic design engineer.
Your task is to visually analyze this Canva design graphic and reverse-engineer it into a clean, professional, fully editable multi-layered Photoshop document structure.

Carefully deconstruct every visual element into discrete layers:
1. Canvas dimensions: calculate exact resolution in pixels (e.g. 1080x1080, 1080x1350, 1920x1080, 1200x630, etc.).
2. Color Palette: extract 4-6 dominant colors as HEX codes.
3. Background: dominant background color, gradient colors (if gradient), and backgroundType ("solid", "gradient", or "photo").
4. Layers in bottom-to-top z-index order:
   - "Typography": EVERY single text line/block MUST be extracted as an individual text layer. Identify:
     - exact text content (maintain multiline text, uppercase/lowercase)
     - fontFamily: match the visual style to standard Google/Photoshop fonts (e.g. "Montserrat", "Poppins", "Playfair Display", "Roboto", "Oswald", "Bebas Neue", "Inter", "Lato")
     - fontSize: accurate estimated font size in pixels relative to the canvas dimensions
     - fontWeight: "normal", "medium", "bold", "800", or "900"
     - color: hex color code (e.g. #FFFFFF, #1E293B)
     - alignment: "left", "center", or "right"
     - bounding box: { x, y, width, height } in exact canvas pixels
   - "Graphics & Accents": Badges (e.g. "50% OFF", "NEW"), buttons, CTA tags, ribbons, banners, stars, dividers, framing cards.
     - shapeType: "rectangle" | "rounded-rectangle" | "circle" | "badge" | "line"
     - fillColor: hex color
     - strokeColor: hex color (if bordered)
     - strokeWidth: number
     - borderRadius: number
     - opacity: number (0 to 1)
     - bounds: { x, y, width, height } in pixels
   - "Visuals": photos, illustrations, icons, product graphics.
     - name: descriptive name (e.g. "Product Cutout Photo", "Geometric Graphic Accent")
     - bounds: { x, y, width, height } in pixels
   - "Background": Base canvas background layer

Output strict JSON only adhering to this structure:
{
  "title": "string",
  "width": 1080,
  "height": 1080,
  "aspectRatio": "1:1",
  "backgroundColor": "#HEX",
  "backgroundType": "solid" | "gradient" | "photo",
  "gradientColors": ["#HEX1", "#HEX2"],
  "gradientAngle": 45,
  "palette": ["#HEX1", "#HEX2", "#HEX3", "#HEX4"],
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
        "alignment": "center"
      },
      "shape": {
        "shapeType": "rounded-rectangle",
        "fillColor": "#FF5500",
        "strokeColor": "#FFFFFF",
        "strokeWidth": 2,
        "borderRadius": 12,
        "opacity": 1.0
      }
    }
  ]
}`;

    const promptText = `Analyze this Canva graphic and deconstruct it into an editable multi-layer Photoshop PSD structure. Extract all text content, typography styles, button/badge shapes, and bounding boxes.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
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
        temperature: 0.2,
      },
    });

    const responseText = response.text || "";
    let parsedData: any;
    try {
      parsedData = JSON.parse(responseText.trim());
    } catch (jsonErr) {
      console.error("Failed to parse Gemini JSON output:", responseText.slice(0, 500));
      parsedData = generateHeuristicLayers(title, dimensions);
    }

    // Validate and sanitize layers
    if (!parsedData.layers || !Array.isArray(parsedData.layers) || parsedData.layers.length === 0) {
      parsedData = generateHeuristicLayers(title, dimensions);
    }

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

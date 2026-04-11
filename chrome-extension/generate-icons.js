#!/usr/bin/env node
// Generates PNG icons from an inline SVG for the Chrome extension.
// Uses Node.js built-ins only — no external dependencies.
// Run: node generate-icons.js

const fs = require('fs');
const path = require('path');

// Simple BMP-based icon generator (Chrome accepts PNG, but we create
// a minimal valid PNG using a pre-built approach)

// We'll create simple colored square icons as valid PNG files
// using a minimal PNG encoder (no dependencies needed)

function createPNG(width, height, colorFn) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk — uncompressed image data
  // Each row: filter byte (0) + RGB pixels
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorFn(x, y, width, height);
      row.push(r, g, b);
    }
    rawRows.push(...row);
  }

  const rawData = Buffer.from(rawRows);
  const compressed = deflateRaw(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// Minimal zlib deflate (store only — no compression, valid deflate stream)
function deflateRaw(data) {
  // zlib header
  const header = Buffer.from([0x78, 0x01]);

  // Split into blocks of max 65535 bytes
  const blocks = [];
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, 65535);
    const isLast = (offset + blockSize >= data.length);

    const blockHeader = Buffer.alloc(5);
    blockHeader[0] = isLast ? 0x01 : 0x00;
    blockHeader.writeUInt16LE(blockSize, 1);
    blockHeader.writeUInt16LE(blockSize ^ 0xFFFF, 3);

    blocks.push(blockHeader, data.slice(offset, offset + blockSize));
    offset += blockSize;
  }

  // Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0, 0);

  return Buffer.concat([header, ...blocks, adler]);
}

// CRC-32 lookup table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---- Icon design ----
function iconColor(x, y, w, h) {
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Rounded rectangle with gradient
  const margin = w * 0.08;
  const cornerR = w * 0.2;

  // Check if inside rounded rect
  const inRect = x >= margin && x < w - margin && y >= margin && y < h - margin;
  const inCorner = (px, py) => {
    const d = Math.sqrt((px) * (px) + (py) * (py));
    return d <= cornerR;
  };

  let inside = false;
  if (inRect) {
    // Check corners
    const lx = x - margin, ly = y - margin;
    const rx = (w - margin) - x, ry = (h - margin) - y;
    const innerW = w - 2 * margin, innerH = h - 2 * margin;

    if (lx < cornerR && ly < cornerR) {
      inside = inCorner(lx - cornerR, ly - cornerR);
    } else if (rx < cornerR && ly < cornerR) {
      inside = inCorner(rx - cornerR, ly - cornerR);
    } else if (lx < cornerR && ry < cornerR) {
      inside = inCorner(lx - cornerR, ry - cornerR);
    } else if (rx < cornerR && ry < cornerR) {
      inside = inCorner(rx - cornerR, ry - cornerR);
    } else {
      inside = true;
    }
  }

  if (!inside) {
    return [240, 240, 245]; // background
  }

  // Gradient from dark blue to teal
  const t = y / h;
  const baseR = Math.round(22 + t * 5);
  const baseG = Math.round(30 + t * 50);
  const baseB = Math.round(60 + t * 40);

  // Draw a simple shield/database shape in the center
  const shieldCx = w / 2;
  const shieldCy = h * 0.42;
  const shieldW = w * 0.32;
  const shieldH = h * 0.25;

  // Database ellipse at top
  const ellipseRx = shieldW;
  const ellipseRy = shieldH * 0.35;
  const ellipseY = shieldCy - shieldH * 0.3;
  const dxE = (x - shieldCx) / ellipseRx;
  const dyE = (y - ellipseY) / ellipseRy;

  if (dxE * dxE + dyE * dyE <= 1) {
    return [79, 195, 247]; // light blue
  }

  // Database body
  if (Math.abs(x - shieldCx) <= shieldW && y >= ellipseY && y <= shieldCy + shieldH * 0.8) {
    // Middle line
    const midY = shieldCy + shieldH * 0.2;
    if (Math.abs(y - midY) < 1.5) {
      return [79, 195, 247];
    }
    return [41, 121, 255]; // blue
  }

  // Arrow at bottom (sync indicator)
  const arrowCy = h * 0.73;
  const arrowW = w * 0.22;
  if (y >= arrowCy - 2 && y <= arrowCy + 2 && Math.abs(x - shieldCx) <= arrowW) {
    return [76, 175, 80]; // green
  }
  // Arrow head
  const arrowTip = shieldCx + arrowW;
  if (x >= arrowTip - w * 0.08 && x <= arrowTip &&
      y >= arrowCy - w * 0.08 && y <= arrowCy + w * 0.08) {
    const adx = x - arrowTip, ady = Math.abs(y - arrowCy);
    if (ady <= -adx * 0.8 + w * 0.02) {
      return [76, 175, 80]; // green
    }
  }

  return [baseR, baseG, baseB];
}

// ---- Generate icons ----
const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const png = createPNG(size, size, iconColor);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated: ${filePath} (${png.length} bytes)`);
}

console.log('Done! Icons generated in icons/');

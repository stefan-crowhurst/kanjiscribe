#!/usr/bin/env node
/**
 * KanjiScribe icon generator — builds every logo/icon asset from a single
 * hand-drawn source file.
 *
 * Source:   ji.svg (repo root) — the hand-drawn white 字 glyph, exported from
 *           Inkscape. Its viewBox is treated as the glyph's full bounding box.
 * Outputs:  apps/web/public/
 *             favicon.svg          browser tab / taskbar icon (smaller glyph)
 *             brand-mark.svg       in-app header logo (larger glyph)
 *             apple-touch-icon.png 180x180, for iOS "Add to Home Screen"
 *             icon-192.png         PWA manifest icon, any purpose
 *             icon-512.png         PWA manifest icon, any purpose
 *             icon-maskable-192.png PWA manifest icon, maskable safe zone
 *             icon-maskable-512.png PWA manifest icon, maskable safe zone
 *
 * All raster variants share the exact SVG markup written to disk, so what you
 * see in-repo is literally what gets rendered into the PNGs.
 *
 * Usage:
 *   pnpm icons                 regenerate all assets from ji.svg
 *   pnpm icons --preview       also write a contact-sheet PNG (icon-preview.png)
 *                              of every size next to the cwd, for eyeballing
 *
 * The glyph is embedded as vector paths inside a nested <svg> scaled onto the
 * green brand tile; Inkscape/Sodipodi editor attributes are stripped because
 * standalone .svg files are parsed as strict XML by browsers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = resolve(ROOT, "apps/web/public");
const PREVIEW = process.argv.includes("--preview");

// ---------------------------------------------------------------------------
// 1. Extract the glyph markup from ji.svg
// ---------------------------------------------------------------------------

// Everything inside <g id="layer1"> is the artwork; the rest of the Inkscape
// document (namedview, grid defs, document metadata) is editor noise.
const raw = readFileSync(resolve(ROOT, "ji.svg"), "utf8");
let glyph = raw.slice(raw.indexOf('id="layer1">') + 'id="layer1">'.length);
glyph = glyph.slice(0, glyph.lastIndexOf("</g></svg>"));

// inkscape:/sodipodi: prefixed attributes have no namespace declaration once
// extracted, which makes strict XML parsers reject the whole file — drop them.
glyph = glyph.replace(/\s(?:inkscape|sodipodi):[\w-]+="[^"]*"/g, "");

const VB = Number(raw.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)[1]); // glyph coord system is square

// ---------------------------------------------------------------------------
// 2. Compose a logo: green gradient tile + glyph centred at a given size
// ---------------------------------------------------------------------------

// The design space is 64x64 units regardless of output resolution. glyphSize
// is the glyph's edge length in design units; it is centred on the canvas.
function composeLogo({ label, tile, glyphSize }) {
  const pad = (64 - glyphSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label}">
${GRAD_DEFS}

  <rect x="${tile.x}" y="${tile.y}" width="${tile.w}" height="${tile.h}" rx="${tile.rx}" fill="url(#bg)" />

  <svg x="${pad}" y="${pad}" width="${glyphSize}" height="${glyphSize}" viewBox="0 0 ${VB} ${VB}">
${glyph}
  </svg>
</svg>
`;
}

const GRAD_DEFS = `  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3f8a5c" />
      <stop offset="1" stop-color="#2f6f49" />
    </linearGradient>
  </defs>`;

// Brand tiles. The rounded tile keeps its transparent surround ("any" icons);
// maskable/apple-touch variants use a square full-bleed tile because launchers
// and iOS apply their own corner masking.
const ROUNDED_TILE = { x: 4, y: 4, w: 56, h: 56, rx: 12 }; // favicon
const MARK_TILE = { x: 2, y: 2, w: 60, h: 60, rx: 13 }; // brand mark + install PNGs
const BLEED_TILE = { x: 0, y: 0, w: 64, h: 64, rx: 0 };

writeFileSync(
  resolve(PUB, "favicon.svg"),
  composeLogo({ label: "Kanjiscribe favicon", tile: ROUNDED_TILE, glyphSize: 34.56 })
);
writeFileSync(
  resolve(PUB, "brand-mark.svg"),
  composeLogo({ label: "Kanjiscribe mark", tile: MARK_TILE, glyphSize: 40.32 })
);
console.log("wrote favicon.svg, brand-mark.svg");

// ---------------------------------------------------------------------------
// 3. Rasterize the install icons via resvg
// ---------------------------------------------------------------------------

const renderPng = (svgString, size) =>
  new Resvg(svgString, { fitTo: { mode: "width", value: size } }).render().asPng();

const savePng = (name, svgString, size) => {
  writeFileSync(resolve(PUB, name), renderPng(svgString, size));
  console.log(`wrote ${name} (${size}x${size})`);
};

// Matches brand-mark.svg exactly.
const anySvg = composeLogo({ label: "kanjiscribe", tile: MARK_TILE, glyphSize: 40.32 });
savePng("icon-192.png", anySvg, 192);
savePng("icon-512.png", anySvg, 512);

// Maskable: glyph pulled well inside the launcher safe zone (central ~66%).
savePng(
  "icon-maskable-192.png",
  composeLogo({ label: "kanjiscribe", tile: BLEED_TILE, glyphSize: 42 }),
  192
);
savePng(
  "icon-maskable-512.png",
  composeLogo({ label: "kanjiscribe", tile: BLEED_TILE, glyphSize: 42 }),
  512
);

// Apple rounds the corners itself, so ship a square full-bleed background with
// slightly more generous glyph padding than the brand mark.
savePng(
  "apple-touch-icon.png",
  composeLogo({ label: "kanjiscribe", tile: BLEED_TILE, glyphSize: 45 }),
  180
);

// ---------------------------------------------------------------------------
// 4. Optional contact-sheet preview (--preview): renders the actual shipped
//    files at several sizes onto one PNG so they can be checked at a glance.
// ---------------------------------------------------------------------------

if (!PREVIEW) process.exit(0);

const W = 960,
  H = 620;
const sheet = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  sheet[i * 4] = 0xd9;
  sheet[i * 4 + 1] = 0xde;
  sheet[i * 4 + 2] = 0xe3;
  sheet[i * 4 + 3] = 255;
}

function paste(img, ox, oy) {
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const si = (y * img.w + x) * 4;
      const di = ((oy + y) * W + ox + x) * 4;
      const a = img.rgba[si + 3] / 255;
      for (let c = 0; c < 3; c++) sheet[di + c] = Math.round(img.rgba[si + c] * a + sheet[di + c] * (1 - a));
      sheet[di + 3] = 255;
    }
}

// Render one of the shipped .svg files at an arbitrary pixel width.
const renderFile = (file, size) => {
  const r = new Resvg(readFileSync(resolve(PUB, file), "utf8"), {
    fitTo: { mode: "width", value: size },
  }).render();
  return { w: r.width, h: r.height, rgba: Buffer.from(r.pixels) };
};

// Decode one of our generated PNGs back to RGBA (only needs to handle what
// resvg emits: 8-bit RGBA with standard row filters).
function decodePng(file) {
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  let pos = 8;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    if (buf.toString("ascii", pos + 4, pos + 8) === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const cur = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 255;
      else if (filter === 2) cur[i] = (cur[i] + b) & 255;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, rgba: out };
}

paste(renderFile("favicon.svg", 256), 48, 40); // top row: shipped SVGs, large
paste(renderFile("brand-mark.svg", 256), 368, 40);

paste(decodePng(resolve(PUB, "icon-192.png")), 48, 360); // bottom row: install PNGs...
paste(decodePng(resolve(PUB, "icon-maskable-192.png")), 288, 360);
paste(decodePng(resolve(PUB, "apple-touch-icon.png")), 528, 366);
paste(renderFile("favicon.svg", 64), 768, 376); // ...and simulated small sizes
paste(renderFile("brand-mark.svg", 64), 768, 464);
paste(renderFile("favicon.svg", 24), 872, 376);
paste(renderFile("brand-mark.svg", 20), 916, 380);

// Minimal PNG encoder for the sheet itself (filter 0 rows, zlib deflate).
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
const rawRows = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) sheet.copy(rawRows, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
const outPath = resolve(process.cwd(), "icon-preview.png");
writeFileSync(
  outPath,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rawRows)),
    chunk("IEND", Buffer.alloc(0)),
  ])
);
console.log(`wrote ${outPath}`);

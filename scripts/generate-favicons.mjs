import sharp from 'sharp';
import { mkdir, writeFile, copyFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const sourceSvg = path.join(root, 'images', 'favicon', 'favicon-source.svg');
const outDir = path.join(root, 'images', 'favicon');

const pngSizes = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'android-chrome-192x192.png', size: 192 },
    { name: 'android-chrome-512x512.png', size: 512 }
];

function createIco(pngBuffers) {
    const count = pngBuffers.length;
    const headerSize = 6 + (count * 16);
    let offset = headerSize;
    const entries = pngBuffers.map((buffer, index) => {
        const entry = {
            width: buffer.width >= 256 ? 0 : buffer.width,
            height: buffer.height >= 256 ? 0 : buffer.height,
            size: buffer.data.length,
            offset
        };
        offset += buffer.data.length;
        return entry;
    });

    const totalSize = offset;
    const output = Buffer.alloc(totalSize);
    output.writeUInt16LE(0, 0);
    output.writeUInt16LE(1, 2);
    output.writeUInt16LE(count, 4);

    let cursor = 6;
    entries.forEach((entry, index) => {
        output.writeUInt8(entry.width, cursor);
        output.writeUInt8(entry.height, cursor + 1);
        output.writeUInt8(0, cursor + 2);
        output.writeUInt8(0, cursor + 3);
        output.writeUInt16LE(1, cursor + 4);
        output.writeUInt16LE(32, cursor + 6);
        output.writeUInt32LE(entry.size, cursor + 8);
        output.writeUInt32LE(entry.offset, cursor + 12);
        cursor += 16;
    });

    pngBuffers.forEach((buffer) => {
        buffer.data.copy(output, buffer.offset);
    });

    return output;
}

async function renderPng(size) {
    return sharp(sourceSvg)
        .resize(size, size, { fit: 'contain', background: '#0D0D0D' })
        .png()
        .toBuffer();
}

await mkdir(outDir, { recursive: true });

const rendered = {};
for (const item of pngSizes) {
    const data = await renderPng(item.size);
    const filePath = path.join(outDir, item.name);
    await writeFile(filePath, data);
    rendered[item.name] = { data, size: item.size };
    console.log(`Wrote ${item.name} (${data.length} bytes)`);
}

const icoEntries = [
    { data: rendered['favicon-16x16.png'].data, width: 16, height: 16 },
    { data: rendered['favicon-32x32.png'].data, width: 32, height: 32 }
];

let cursor = 6 + (icoEntries.length * 16);
const packed = icoEntries.map((entry) => {
    const packedEntry = { ...entry, offset: cursor };
    cursor += entry.data.length;
    return packedEntry;
});

const icoBuffer = createIco(packed);
const icoPath = path.join(outDir, 'favicon.ico');
await writeFile(icoPath, icoBuffer);
await copyFile(icoPath, path.join(root, 'favicon.ico'));
console.log(`Wrote favicon.ico (${icoBuffer.length} bytes)`);

const manifest = {
    name: 'AFIFI',
    short_name: 'AFIFI',
    description: 'Premium Egyptian streetwear by AFIFI Brands.',
    icons: [
        {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
        },
        {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png'
        }
    ],
    theme_color: '#0D0D0D',
    background_color: '#0D0D0D',
    display: 'standalone'
};

await writeFile(path.join(outDir, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Wrote site.webmanifest');

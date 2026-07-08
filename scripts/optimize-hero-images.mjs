import sharp from 'sharp';
import { mkdir, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'images', 'hero');

const slides = [
    { id: 1, input: 'slide img .png' },
    { id: 2, input: 'slide img 2.png' },
    { id: 3, input: 'slide img 3.png' }
];

const widths = [768, 1280, 1920];
const webpQuality = 82;
const avifQuality = 55;

async function writeVariant(inputPath, slideId, width, format, quality) {
    const ext = format === 'webp' ? 'webp' : 'avif';
    const outputPath = path.join(outDir, `slide-${slideId}-${width}.${ext}`);
    const pipeline = sharp(inputPath)
        .rotate()
        .resize({ width, withoutEnlargement: true });

    if (format === 'webp') {
        await pipeline.webp({ quality, effort: 4 }).toFile(outputPath);
    } else {
        await pipeline.avif({ quality, effort: 4 }).toFile(outputPath);
    }

    const { size } = await stat(outputPath);
    return { outputPath, size };
}

await mkdir(outDir, { recursive: true });

const report = [];

for (const slide of slides) {
    const inputPath = path.join(root, 'images', slide.input);
    const original = await stat(inputPath);

    for (const width of widths) {
        for (const format of ['webp', 'avif']) {
            const quality = format === 'webp' ? webpQuality : avifQuality;
            const result = await writeVariant(inputPath, slide.id, width, format, quality);
            report.push({
                slide: slide.id,
                width,
                format,
                kb: Math.round(result.size / 1024)
            });
        }
    }

    report.push({
        slide: slide.id,
        originalKb: Math.round(original.size / 1024)
    });
}

console.log(JSON.stringify(report, null, 2));

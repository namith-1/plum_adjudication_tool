import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pdf } from 'pdf-to-img';

const inputFiles = process.argv.slice(2);

if (inputFiles.length === 0) {
  console.error('Usage: node scripts/convertPdfToImages.mjs <file.pdf> [more.pdf]');
  process.exit(1);
}

async function convertPdfToImages(inputFile) {
  const absoluteInput = path.resolve(inputFile);
  const outputDirectory = path.join(path.dirname(absoluteInput), `${path.basename(inputFile, path.extname(inputFile))}_pages`);
  await fs.mkdir(outputDirectory, { recursive: true });

  let counter = 1;
  const document = await pdf(absoluteInput, { scale: 3 });

  for await (const image of document) {
    const outputPath = path.join(outputDirectory, `page_${counter}.png`);
    await fs.writeFile(outputPath, image);
    console.log(`Successfully saved ${outputPath}`);
    counter += 1;
  }
}

for (const inputFile of inputFiles) {
  try {
    await convertPdfToImages(inputFile);
  } catch (error) {
    console.error(`Error converting ${inputFile}:`, error);
    process.exitCode = 1;
  }
}

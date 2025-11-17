import fs from 'fs';
import path from 'path';

const srcDir = path.resolve('src');
const distDir = path.resolve('dist');

async function removeDist() {
  await fs.promises.rm(distDir, { recursive: true, force: true });
}

async function copyDirectory(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  await removeDist();
  await copyDirectory(srcDir, distDir);
  // Build marker for quick sanity checks
  await fs.promises.writeFile(path.join(distDir, '.build-complete'), new Date().toISOString());
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});

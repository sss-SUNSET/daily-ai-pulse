import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve('data');
const PUBLIC_DATA_DIR = path.resolve('public', 'data');

/**
 * Copy all archived daily JSON files from data/ into public/data/
 * and generate public/data/index.json for static GitHub Pages hosting.
 */
async function syncStaticData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.rm(PUBLIC_DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(PUBLIC_DATA_DIR, { recursive: true });

  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort((a, b) => b.localeCompare(a));

  const dates = jsonFiles.map(file => file.replace('.json', ''));

  await Promise.all(
    jsonFiles.map(file =>
      fs.copyFile(path.join(DATA_DIR, file), path.join(PUBLIC_DATA_DIR, file))
    )
  );

  const manifest = {
    success: true,
    dates,
    total: dates.length,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(PUBLIC_DATA_DIR, 'index.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );

  console.log(`[Static Sync] Synced ${dates.length} daily summaries to public/data/index.json`);
}

syncStaticData().catch(err => {
  console.error('[Static Sync] Failed:', err);
  process.exit(1);
});

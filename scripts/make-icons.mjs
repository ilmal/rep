import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const b = await chromium.launch();
const render = async (svgFile, size, out) => {
  const svg = readFileSync(svgFile, 'utf8');
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await p.screenshot({ path: out, omitBackground: true });
  await p.close();
};
await render('public/icon.svg', 192, 'public/icon-192.png');
await render('public/icon.svg', 512, 'public/icon-512.png');
// iOS fills transparency with black, so the touch icon is full-bleed (iOS rounds the corners itself)
writeFileSync('/tmp/apple-icon-n23.svg', readFileSync('public/icon.svg', 'utf8').replace(' rx="112"', ''));
await render('/tmp/apple-icon-n23.svg', 180, 'public/apple-touch-icon.png');
await render('public/icon-maskable.svg', 512, 'public/icon-maskable-512.png');
await b.close();

import puppeteer from 'puppeteer';
import fs from 'fs';
import { URL } from 'url';

const startUrl = 'https://www.unimedbh.com.br/'; // 🟢 troque pelo site alvo
const maxDepth = 1; // 0 = apenas a inicial, 1 = links diretos, 2 = mais profundo
const visited = new Set();
const discovered = new Set();

async function crawl(url, depth = 0, baseDomain = null, browser) {
  if (depth > maxDepth || visited.has(url)) return;
  visited.add(url);

  const domain = baseDomain || new URL(url).hostname;
  console.log(`🔍 Descobrindo (${depth}): ${url}`);

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // captura todos os links da página
    const links = await page.$$eval('a[href]', (as) =>
      as.map((a) => a.href).filter((h) => h.startsWith('http'))
    );
    await page.close();

    // filtra apenas links internos
    const internalLinks = links.filter((link) => new URL(link).hostname === domain);

    for (const link of new Set(internalLinks)) {
      discovered.add(link);
      await crawl(link, depth + 1, domain, browser);
    }
  } catch (err) {
    console.warn(`⚠️ Falha ao abrir ${url}: ${err.message}`);
  }
}

async function main() {
  console.log(`🚀 Iniciando descoberta de URLs em ${startUrl}`);
  const browser = await puppeteer.launch({ headless: true });
  await crawl(startUrl, 0, null, browser);
  await browser.close();

  const list = Array.from(discovered);
  fs.writeFileSync('urls-discovered.txt', list.join('\n'), 'utf8');

  console.log('\n✅ Descoberta concluída.');
  console.log(`📄 Total de URLs únicas encontradas: ${list.length}`);
  console.log('💾 Salvo em: urls-discovered.txt');
}

main();
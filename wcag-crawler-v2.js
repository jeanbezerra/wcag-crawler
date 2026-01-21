import puppeteer from 'puppeteer';
import fs from 'fs';
import { URL } from 'url';
import axeSource from 'axe-core';

// =========================
// Entrada: Pipeline Param
// =========================
// Prioridade:
// 1) CLI: node wcag-crawler-v2.js https://example.com
// 2) ENV: SITE_URL=https://example.com
// 3) fallback (opcional)
const inputUrl = process.argv[2] || process.env.SITE_URL || 'https://jeanbezerra.com';

function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Aceita "example.com" e força https://
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const u = new URL(withProtocol);
    // Normaliza: remove fragmento e garante / no final do path se vazio
    u.hash = '';
    if (!u.pathname) u.pathname = '/';
    return u.toString();
  } catch {
    return null;
  }
}

const START_URL = normalizeUrl(inputUrl);

if (!START_URL) {
  console.error(`❌ URL inválida. Use: node wcag-crawler-v2.js https://site.com (ou defina SITE_URL).`);
  process.exit(1);
}

// Configurações
const MAX_DEPTH = 1;
const MAX_CONCURRENCY = 3; // número máximo de abas simultâneas
const DELAY_MS = 500;

const visited = new Set();
const reports = [];

/**
 * Função utilitária para limitar concorrência
 */
async function runWithConcurrency(tasks, maxConcurrent) {
  const results = [];
  const queue = [...tasks];

  async function worker() {
    while (queue.length) {
      const task = queue.shift();
      if (task) {
        try {
          results.push(await task());
        } catch (err) {
          console.error(`⚠️ Erro em tarefa: ${err?.message || err}`);
        }
      }
    }
  }

  const workers = Array.from({ length: maxConcurrent }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Coleta e audita uma página
 */
async function auditPage(browser, url, depth, baseDomain) {
  if (depth > MAX_DEPTH || visited.has(url)) return;
  visited.add(url);

  console.log(`🔍 Auditando [${depth}] ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Injeta axe-core
    await page.addScriptTag({ content: axeSource.source });

    const results = await page.evaluate(async () => await axe.run(document));
    reports.push({ url, violations: results.violations });

    // Captura links internos
    const links = await page.$$eval('a[href]', as =>
      as.map(a => a.href).filter(h => h && h.startsWith('http'))
    );

    const internalLinks = links.filter(link => {
      try {
        return new URL(link).hostname === baseDomain;
      } catch {
        return false;
      }
    });

    await page.close();

    const uniqueLinks = [...new Set(internalLinks)];
    const nextTasks = uniqueLinks.map(link => async () => {
      await new Promise(r => setTimeout(r, DELAY_MS));
      await auditPage(browser, link, depth + 1, baseDomain);
    });

    await runWithConcurrency(nextTasks, MAX_CONCURRENCY);
  } catch (err) {
    console.error(`❌ Erro em ${url}: ${err?.message || err}`);
    try {
      await page.close();
    } catch {}
  }
}

/**
 * Geração do relatório visual
 */
function generateHtmlReport() {
  const totalPages = reports.length || 0;
  const totalViolations = reports.reduce((sum, r) => sum + (r.violations?.length || 0), 0);

  const impactCount = {};
  for (const r of reports) {
    for (const v of (r.violations || [])) {
      const impact = v.impact || 'unknown';
      impactCount[impact] = (impactCount[impact] || 0) + 1;
    }
  }

  const impacts = Object.keys(impactCount);
  const impactValues = Object.values(impactCount);

  const rows = reports.map(r => `
    <tr>
      <td><a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url}</a></td>
      <td>${r.violations.length}</td>
      <td>
        ${r.violations.map(v => `
          <div class="mb-3">
            <strong>${v.id}</strong> - ${v.help}
            <br><em class="text-danger">${v.impact || 'unknown'}</em>
            <ul>
              ${v.nodes.map(n =>
                `<li><code>${n.target.join(', ')}</code> - ${n.failureSummary}</li>`
              ).join('')}
            </ul>
          </div>`).join('')}
      </td>
    </tr>`).join('');

  const avg = totalPages > 0 ? (totalViolations / totalPages).toFixed(1) : '0.0';

  const html = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <title>Relatório de Acessibilidade (WCAG)</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>
    <style>
      body { background-color: #f8f9fa; padding: 30px; }
      h1 { margin-bottom: 20px; }
      .big-number { font-size: 2rem; font-weight: 700; }
      .card { border-radius: 1rem; }
      .table thead th { background-color: #e9ecef; }
    </style>
  </head>
  <body>
    <div class="container-fluid">
      <h1 class="mb-2">Relatório de Acessibilidade - WCAG 2.1 AA</h1>
      <div class="text-muted mb-4">URL inicial: <a href="${START_URL}" target="_blank" rel="noopener noreferrer">${START_URL}</a></div>

      <div class="row mb-4 text-center">
        <div class="col-md-4">
          <div class="card shadow-sm p-3">
            <div class="text-secondary">Páginas Auditadas</div>
            <div class="big-number text-primary">${totalPages}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card shadow-sm p-3">
            <div class="text-secondary">Total de Violações</div>
            <div class="big-number text-danger">${totalViolations}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card shadow-sm p-3">
            <div class="text-secondary">Média por Página</div>
            <div class="big-number text-warning">${avg}</div>
          </div>
        </div>
      </div>

      <div class="card mb-4 shadow-sm">
        <div class="card-header bg-primary text-white">Distribuição de Violações por Impacto</div>
        <div class="card-body">
          <div id="impactChart" style="height:400px;"></div>
        </div>
      </div>

      <div class="card shadow-sm">
        <div class="card-header bg-dark text-white">Detalhes por Página</div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="table table-striped align-middle">
              <thead>
                <tr>
                  <th>Página</th>
                  <th>Problemas</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <script>
      const chart = echarts.init(document.getElementById('impactChart'));
      const option = {
        tooltip: { trigger: 'item' },
        legend: { top: '5%', left: 'center' },
        series: [{
          name: 'Impacto',
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
          label: { show: false, position: 'center' },
          emphasis: { label: { show: true, fontSize: 18, fontWeight: 'bold' }},
          labelLine: { show: false },
          data: ${JSON.stringify(impacts.map((i, idx) => ({ name: i, value: impactValues[idx] })))}
        }]
      };
      chart.setOption(option);
    </script>
  </body>
  </html>`;

  fs.writeFileSync('wcag-report.html', html, 'utf8');
  console.log(`📊 Relatório visual gerado: wcag-report.html`);
}

/**
 * Execução principal
 */
(async () => {
  console.log(`🚀 Iniciando auditoria WCAG em ${START_URL}`);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  const domain = new URL(START_URL).hostname;

  await auditPage(browser, START_URL, 0, domain);

  await browser.close();

  generateHtmlReport();

  // Opcional: falhar pipeline se houver violações
  // if (reports.some(r => (r.violations || []).length > 0)) process.exit(2);
})();
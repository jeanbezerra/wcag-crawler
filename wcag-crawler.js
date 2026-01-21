import puppeteer from 'puppeteer';
import fs from 'fs';
import { URL } from 'url';
import axeSource from 'axe-core';

// Configurações
const startUrl = 'https://yaman.com.br';
const maxDepth = 1; // ajuste se quiser rastrear links internos
const visited = new Set();
const reports = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function crawlAndAudit(url, depth = 0, baseDomain = null) {
  if (depth > maxDepth || visited.has(url)) return;
  visited.add(url);

  const domain = baseDomain || new URL(url).hostname;
  console.log(`🔍 Auditando (${depth}): ${url}`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.addScriptTag({ content: axeSource.source });

    const results = await page.evaluate(async () => await axe.run(document));
    reports.push({ url, violations: results.violations });

    // coleta links internos
    const links = await page.$$eval('a[href]', (as) =>
      as.map((a) => a.href).filter((h) => h.startsWith('http'))
    );
    const internalLinks = links.filter((link) => new URL(link).hostname === domain);

    await browser.close();

    for (const link of new Set(internalLinks)) {
      await delay(1000);
      await crawlAndAudit(link, depth + 1, domain);
    }
  } catch (err) {
    console.error(`❌ Erro em ${url}:`, err.message);
    await browser.close();
  }
}

function generateHtmlReport() {
  const totalPages = reports.length;
  const totalViolations = reports.reduce((sum, r) => sum + r.violations.length, 0);

  // Impact counts para o gráfico
  const impactCount = {};
  reports.forEach(r =>
    r.violations.forEach(v => {
      const impact = v.impact || "unknown";
      impactCount[impact] = (impactCount[impact] || 0) + 1;
    })
  );

  const impacts = Object.keys(impactCount);
  const impactValues = Object.values(impactCount);

  const rows = reports.map(r => `
    <tr>
      <td><a href="${r.url}" target="_blank">${r.url}</a></td>
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
      <h1 class="mb-4">Relatório de Acessibilidade - WCAG 2.1 AA</h1>

      <!-- Big Numbers -->
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
            <div class="big-number text-warning">${(totalViolations / totalPages).toFixed(1)}</div>
          </div>
        </div>
      </div>

      <!-- Gráfico -->
      <div class="card mb-4 shadow-sm">
        <div class="card-header bg-primary text-white">Distribuição de Violações por Impacto</div>
        <div class="card-body">
          <div id="impactChart" style="height:400px;"></div>
        </div>
      </div>

      <!-- Tabela Detalhada -->
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

function generateHtmlConsolidatedReport(dashboardHtml, tableHtml) {
  const html = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Yaman - WCAG Consolidado</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
      body { background: #f8f9fa; font-family: 'Inter', sans-serif; }
      .nav-tabs .nav-link.active {
        background: #63398E; color: #fff; font-weight: 600;
      }
      .nav-tabs .nav-link { color: #63398E; font-weight: 600; }
      iframe { width: 100%; height: 85vh; border: none; border-radius: 0 0 10px 10px; background: #fff; }
      .brand-divider { height: 4px; background: linear-gradient(90deg, #301E46, #63398E, #8031B5, #DFE33D); border-radius: 999px; }
      .print-btn { position: fixed; top: 10px; right: 10px; z-index: 99; }
      @media print {
        .no-print { display:none !important; }
        iframe { height: auto; }
      }
    </style>
  </head>
  <body>
    <div class="no-print">
      <button class="btn btn-outline-dark btn-sm print-btn" onclick="window.print()">🖨️ Imprimir</button>
    </div>

    <div class="container-fluid mt-3">
      <h1 class="fw-bold text-dark mb-2">Yaman - WCAG Automation</h1>
      <div class="brand-divider mb-3"></div>

      <!-- Abas -->
      <ul class="nav nav-tabs" id="wcagTabs" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link active" id="tab-dashboard" data-bs-toggle="tab" data-bs-target="#dashboard" type="button" role="tab">📊 Dashboard Consolidado</button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link" id="tab-report" data-bs-toggle="tab" data-bs-target="#report" type="button" role="tab">📋 Relatório Técnico</button>
        </li>
      </ul>

      <div class="tab-content" id="wcagTabsContent">
        <div class="tab-pane fade show active" id="dashboard" role="tabpanel">
          <iframe srcdoc="${dashboardHtml.replace(/"/g, '&quot;')}"></iframe>
        </div>
        <div class="tab-pane fade" id="report" role="tabpanel">
          <iframe srcdoc="${tableHtml.replace(/"/g, '&quot;')}"></iframe>
        </div>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  </body>
  </html>`;

  fs.writeFileSync('wcag-dashboard.html', html, 'utf8');
  console.log('✅ Relatório consolidado gerado: wcag-dashboard.html');
}


// Execução principal
(async () => {
  console.log(`🚀 Iniciando auditoria WCAG em ${startUrl}`);
  await crawlAndAudit(startUrl);
  generateHtmlReport(); // mantém compatibilidade
  const dashboardHtml = fs.readFileSync('./wcag-dashboard-yaman-light.html', 'utf8');
  const tableHtml = fs.readFileSync('./wcag-report.html', 'utf8');
  generateHtmlConsolidatedReport(dashboardHtml, tableHtml);
})();
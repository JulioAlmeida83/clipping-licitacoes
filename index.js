// =============================================
// CLIPPING EXECUTIVO v14.0 - CÓDIGO OTIMIZADO
// NLC/PGE/SP - Sistema Profissional
// =============================================

const cron = require('node-cron');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// =====================
// CONFIGURAÇÃO CENTRALIZADA
// =====================
const CONFIG = {
  API: {
    perplexity: process.env.PERPLEXITY_API_KEY,
    sendgrid: process.env.SENDGRID_API_KEY,
    timeout: 15000,
    maxRetries: 3
  },
  EMAIL: {
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: (date) => `📡 Clipping Executivo – ${date}`
  },
  CACHE: {
    ttl: 3600000, // 1 hora
    maxSize: 50
  },
  RSS_FEEDS: {
    tcu: [
      'https://portal.tcu.gov.br/RSS/informativo-de-licitacoes-e-contratos.xml',
      'https://portal.tcu.gov.br/RSS/boletim-de-jurisprudencia.xml'
    ],
    tcesp: [
      'https://www.tce.sp.gov.br/rss/boletim-jurisprudencia',
      'https://www.tce.sp.gov.br/rss/boletim'
    ]
  },
  SOURCES: {
    pncp: ['pncp.gov.br'],
    compras: ['comprasnet.gov.br', 'compras.sp.gov.br', 'gov.br/compras'],
    tribunais: ['tcu.gov.br', 'tce.sp.gov.br', 'agu.gov.br', 'stj.jus.br', 'stf.jus.br'],
    legislacao: ['planalto.gov.br', 'in.gov.br', 'senado.leg.br'],
    periodicos: ['zenite.com.br', 'ronnycharles.com.br', 'jota.info', 'conjur.com.br']
  },
  FILTERS: {
    pregao: { required: ['pregão'], with: ['edital', 'termo de referência'] },
    dispensa: { required: ['dispensa'], with: ['justificativa', 'parecer jurídico'] },
    ms: { required: ['mandado de segurança'], with: ['licitação', 'desclassificação'] }
  },
  AUTHORS: [
    'Flávio Amaral Garcia', 'Ronny Charles', 'Joel de Menezes Niebuhr',
    'Jorge Jacoby Fernandes', 'Jessé Torres', 'Maria Sylvia di Pietro'
  ]
};

// =====================
// SISTEMA DE CACHE
// =====================
const cache = new Map();

const cacheGet = (key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CONFIG.CACHE.ttl) return cached.data;
  return null;
};

const cacheSet = (key, data) => {
  cache.set(key, { data, time: Date.now() });
  if (cache.size > CONFIG.CACHE.maxSize) {
    const oldest = Array.from(cache.entries()).sort((a, b) => a[1].time - b[1].time)[0];
    cache.delete(oldest[0]);
  }
};

const cached = async (key, fn) => cacheGet(key) || (await fn().then(data => (cacheSet(key, data), data)));

// =====================
// UTILITIES
// =====================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const retry = async (fn, retries = CONFIG.API.maxRetries) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.response?.status === 429 && i < retries - 1) {
        await sleep(Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000));
        continue;
      }
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
};

const filterMatches = (text) => {
  if (!text) return { matches: false, types: [] };
  const lower = text.toLowerCase();
  const types = Object.entries(CONFIG.FILTERS)
    .filter(([_, f]) => f.required.some(r => lower.includes(r)) && f.with.some(w => lower.includes(w)))
    .map(([name]) => name);
  return { matches: types.length > 0, types };
};

// =====================
// RSS/ATOM PARSER
// =====================
const parseRSS = async (url, source) => {
  try {
    const { data } = await axios.get(url, {
      timeout: CONFIG.API.timeout,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/atom+xml' }
    });
    
    const $ = cheerio.load(data, { xmlMode: true, decodeEntities: true });
    const items = [];
    
    $('item, entry').slice(0, 5).each((_, el) => {
      const titulo = $(el).find('title').text().trim();
      let link = $(el).find('link').text().trim() || $(el).find('link').attr('href') || $(el).find('guid').text().trim();
      
      if (link && !link.startsWith('http')) {
        link = new URL(url).origin + (link.startsWith('/') ? link : '/' + link);
      }
      
      const desc = $(el).find('description, summary, content').first().text().trim().substring(0, 200);
      const dataPub = $(el).find('pubDate, published, updated, date').first().text().trim();
      let dataFormatada = 'Data indisponível';
      
      if (dataPub) {
        try {
          const d = new Date(dataPub);
          if (!isNaN(d.getTime())) dataFormatada = d.toLocaleDateString('pt-BR');
        } catch {}
      }
      
      if (titulo && link) items.push({ titulo, link, desc, data: dataFormatada });
    });
    
    console.log(`✅ ${source}: ${items.length} itens via RSS`);
    return items;
  } catch (err) {
    console.error(`❌ RSS ${source}:`, err.message);
    return null;
  }
};

// =====================
// WEB SCRAPING
// =====================
const scrape = async (url, selectors, source) => {
  return cached(`scrape:${source}`, async () => {
    try {
      const { data } = await axios.get(url, {
        timeout: CONFIG.API.timeout,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      
      const $ = cheerio.load(data);
      const items = [];
      
      $(selectors.container).slice(0, 5).each((_, el) => {
        const titulo = $(el).find(selectors.title).text().trim();
        let link = $(el).find('a').attr('href');
        if (link && !link.startsWith('http')) link = new URL(url).origin + link;
        const data = $(el).find(selectors.date || '.data').text().trim();
        
        if (titulo && link) items.push(`• ${titulo}${data ? ` (${data})` : ''}\n  ${link}`);
      });
      
      return items.length > 0 ? items.join('\n\n') : `Nenhum item em ${source}.`;
    } catch (err) {
      console.error(`❌ Scrape ${source}:`, err.message);
      return `Erro ao acessar ${source}.`;
    }
  });
};

// =====================
// PERPLEXITY API
// =====================
const queryPerplexity = async (prompt, sources = []) => {
  return retry(async () => {
    const { data } = await axios.post('https://api.perplexity.ai/chat/completions', {
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Assistente especialista em licitações. Seja objetivo e direto.' },
        { role: 'user', content: prompt.substring(0, 2000) }
      ],
      return_citations: true,
      max_tokens: 2000,
      ...(sources.length > 0 && { search_domain_filter: sources.slice(0, 20) })
    }, {
      headers: { 
        'Authorization': `Bearer ${CONFIG.API.perplexity}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return {
      sucesso: true,
      conteudo: data.choices[0].message.content,
      citacoes: data.citations || []
    };
  }).catch(err => ({
    sucesso: false,
    conteudo: 'Informação temporariamente indisponível.',
    erro: err.message
  }));
};

// =====================
// BUSCAS TEMÁTICAS
// =====================
const searches = {
  pncp: () => queryPerplexity(
    'Liste licitações PNCP últimas 24h: modalidades especiais, valor > 100M ou grandes projetos. Formato: • Título (data) – Órgão, Valor, Link.',
    CONFIG.SOURCES.pncp
  ),
  
  compras: () => queryPerplexity(
    'Liste comunicados SGGD/SP, ComprasNet últimas 24h: sistemas, Lei 14.133, índices. Formato: • Título (data) – Portal, Link.',
    CONFIG.SOURCES.compras
  ),
  
  atos: () => queryPerplexity(
    'Liste atos normativos Lei 14.133 últimas 24h: INs, Decretos, Portarias. Formato: • Título (data) – Órgão, Link DOE/DOU.',
    CONFIG.SOURCES.legislacao
  ),
  
  decisoes: () => queryPerplexity(
    'Liste decisões judiciais licitações/contratos últimas 24h: STF, STJ, TJs, TCU. Formato: • Título (data) – Tribunal, Link.',
    [...CONFIG.SOURCES.tribunais, 'jota.info', 'conjur.com.br']
  ),
  
  eventos: () => queryPerplexity(
    `Liste eventos licitações próximos 180 dias com: ${CONFIG.AUTHORS.join(', ')}. Formato: • Nome (data) – Instituição, Link.`,
    CONFIG.SOURCES.periodicos
  ),
  
  artigos: () => queryPerplexity(
    `Liste artigos últimas 24h de: ${CONFIG.AUTHORS.join(', ')}. Formato: • Título (data) – Autor, Link.`,
    CONFIG.SOURCES.periodicos
  )
};

// =====================
// RSS FEEDS
// =====================
const feeds = {
  tcuInformativo: () => cached('tcu-info', async () => {
    for (const url of CONFIG.RSS_FEEDS.tcu) {
      const result = await parseRSS(url, 'TCU Informativo');
      if (result) return result.map(i => `• ${i.titulo} (${i.data})\n  ${i.desc}\n  ${i.link}`).join('\n\n');
    }
    return 'Feed TCU indisponível.';
  }),
  
  tcuBoletim: () => cached('tcu-boletim', async () => {
    const result = await parseRSS(CONFIG.RSS_FEEDS.tcu[1], 'TCU Boletim');
    return result ? result.map(i => `• ${i.titulo} (${i.data})\n  ${i.link}`).join('\n\n') : 'Feed TCU Boletim indisponível.';
  }),
  
  tcespBoletim: () => cached('tcesp-boletim', async () => {
    for (const url of CONFIG.RSS_FEEDS.tcesp) {
      const result = await parseRSS(url, 'TCE-SP Boletim');
      if (result) return result.map(i => `• ${i.titulo} (${i.data})\n  ${i.link}`).join('\n\n');
    }
    return 'Feed TCE-SP indisponível.';
  })
};

// =====================
// GERAÇÃO DO RELATÓRIO
// =====================
const generateReport = async () => {
  console.log('🚀 Gerando relatório...');
  
  const [
    pncp, compras, atos, decisoes, eventos, artigos,
    tcuInfo, tcuBoletim, tcespBoletim,
    tcespNews, tcuNews
  ] = await Promise.allSettled([
    searches.pncp(),
    searches.compras(),
    searches.atos(),
    searches.decisoes(),
    searches.eventos(),
    searches.artigos(),
    feeds.tcuInformativo(),
    feeds.tcuBoletim(),
    feeds.tcespBoletim(),
    scrape('https://www.tce.sp.gov.br/noticias', { container: '.noticia-item', title: 'h2' }, 'TCE-SP'),
    scrape('https://portal.tcu.gov.br/imprensa/noticias', { container: '.noticia-item', title: 'h2' }, 'TCU')
  ]);
  
  const extract = (r) => r.status === 'fulfilled' ? (r.value?.conteudo || r.value) : 'Erro ao carregar';
  
  const content = `
═══ 📋 LICITAÇÕES PNCP ═══
${extract(pncp)}

═══ 🛒 COMPRAS.SP ═══
${extract(compras)}

═══ 📑 ATOS NORMATIVOS ═══
${extract(atos)}

═══ 📘 TCU INFORMATIVO ═══
${extract(tcuInfo)}

═══ 📗 TCU BOLETIM ═══
${extract(tcuBoletim)}

═══ 🟣 TCU NOTÍCIAS ═══
${extract(tcuNews)}

═══ 📄 TCE-SP BOLETIM ═══
${extract(tcespBoletim)}

═══ 🟦 TCE-SP NOTÍCIAS ═══
${extract(tcespNews)}

═══ ⚖️ DECISÕES JUDICIAIS ═══
${extract(decisoes)}

═══ 🎓 EVENTOS ═══
${extract(eventos)}

═══ 📰 ARTIGOS ═══
${extract(artigos)}
`;

  const filters = filterMatches(content);
  const filterBadge = filters.matches ? 
    `<div style="background:#e8f5e9;border-left:4px solid #4caf50;padding:15px;margin:20px 0;">
      <strong>🎯 Filtros: ${filters.types.join(', ')}</strong>
    </div>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Clipping NLC/PGE/SP</title></head>
<body style="font-family:sans-serif;margin:0;">
  <div style="background:linear-gradient(135deg,#134252,#1a5666);color:white;padding:25px;text-align:center;">
    <h1>Clipping Executivo - Licitações & Contratos</h1>
    <p>NLC/PGE/SP | ${new Date().toLocaleString('pt-BR')}</p>
    <span style="background:#e8f5e9;color:#2e7d32;padding:4px 12px;border-radius:12px;font-size:12px;">
      📡 RSS + Scraping + IA
    </span>
  </div>
  <div style="padding:25px;">
    ${filterBadge}
    <pre style="background:#f8f9fa;padding:20px;border-radius:6px;white-space:pre-wrap;font-size:13px;line-height:1.6;">${content}</pre>
  </div>
  <div style="background:#f4f4f4;padding:18px;text-align:center;font-size:12px;color:#666;">
    v14.0 | Powered by Perplexity AI
  </div>
</body>
</html>`;

  await sendEmail(html);
};

// =====================
// ENVIO DE EMAIL
// =====================
const sendEmail = async (html, retries = 3) => {
  if (!CONFIG.API.sendgrid) {
    console.error('❌ SENDGRID_API_KEY não configurada');
    return saveToFile(html);
  }

  for (let i = 0; i < retries; i++) {
    try {
      await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{
          to: CONFIG.EMAIL.to.split(',').map(e => ({ email: e.trim() })),
          subject: CONFIG.EMAIL.subject(new Date().toLocaleDateString('pt-BR'))
        }],
        from: { email: CONFIG.EMAIL.from, name: 'Clipping NLC/PGE/SP' },
        content: [{ type: 'text/html', value: html }]
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.API.sendgrid}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      console.log('✅ Email enviado!');
      return;
    } catch (err) {
      console.error(`❌ Tentativa ${i + 1}/${retries}:`, err.message);
      if (i < retries - 1) await sleep(2000 * (i + 1));
      else saveToFile(html);
    }
  }
};

const saveToFile = (html) => {
  const filename = `relatorio-${new Date().toISOString().split('T')[0]}.html`;
  fs.writeFileSync(filename, html, 'utf8');
  console.log(`💾 Salvo em ${filename}`);
};

// =====================
// API ROUTES
// =====================
app.get('/', (req, res) => res.json({
  status: 'online',
  version: '14.0-Optimized',
  uptime: Math.floor(process.uptime()),
  cache: cache.size
}));

app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  version: '14.0',
  cache: { entries: cache.size, maxSize: CONFIG.CACHE.maxSize },
  memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
}));

app.get('/run', async (req, res) => {
  res.json({ message: 'Gerando relatório em background' });
  generateReport().catch(console.error);
});

app.post('/cache/clear', (req, res) => {
  const size = cache.size;
  cache.clear();
  res.json({ cleared: size });
});

// =====================
// INICIALIZAÇÃO
// =====================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║  🎯 CLIPPING v14.0 - OTIMIZADO    ║
║     NLC/PGE/SP                     ║
╚════════════════════════════════════╝
🌐 http://localhost:${PORT}
📊 /api/health | 🔧 /run | 🗑️ /cache/clear
  `);
});

// Cron: 7h AM diariamente
cron.schedule('0 7 * * *', () => {
  console.log('⏰ Executando clipping agendado...');
  generateReport().catch(console.error);
}, { timezone: 'America/Sao_Paulo' });

// Teste em dev
if (process.env.NODE_ENV !== 'production') {
  setTimeout(() => generateReport().catch(console.error), 10000);
}

// Graceful shutdown
['SIGTERM', 'SIGINT'].forEach(sig => 
  process.on(sig, () => (console.log(`\n⚠️ ${sig}`), cache.clear(), process.exit(0)))
);

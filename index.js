// Updated
const fetch = require('node-fetch');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
  PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
  EMAIL: {
    service: 'gmail',
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    password: process.env.EMAIL_PASSWORD
  },
  FEEDS_RSS: {
    tcuInformativoLicitacoes: 'https://portal.tcu.gov.br/RSS/informativo-de-licitacoes-e-contratos.xml',
    tcuBoletimJurisprudencia: 'https://portal.tcu.gov.br/RSS/boletim-de-jurisprudencia.xml',
    tceSpBoletim: 'https://www.tce.sp.gov.br/rss/boletim-jurisprudencia'
  },
  FONTES: {
    pncp: ['pncp.gov.br'],
    comprasPublicas: ['comprasnet.gov.br', 'compras.sp.gov.br', 'gestao.gov.br', 'gov.br/compras'],
    tribunaisContas: ['tcu.gov.br', 'tce.sp.gov.br'],
    orgaosJuridicos: ['agu.gov.br', 'stj.jus.br', 'stf.jus.br', 'tjsp.jus.br', 'tjrj.jus.br', 'documentacao.pge.rj.gov.br'],
    legislacao: ['planalto.gov.br', 'in.gov.br', 'senado.leg.br', 'camara.leg.br', 'tce.sp.gov.br', 'doe.sp.gov.br', 'legislacaofinanceira.fazenda.sp.gov.br'],
    eventos: ['zenite.com.br', 'ronnycharles.com.br', 'direitodoestado.com.br', 'licitacaoecontrato.com.br', 'jota.info', 'conjur.com.br', 'bnportal.pge.rj.gov.br'],
    periodicos: ['zenite.com.br/artigos', 'ronnycharles.com.br/artigos', 'jota.info', 'direitodoestado.com.br', 'conjur.com.br', 'licitanews.com.br', 'bnportal.pge.rj.gov.br'],
    especialistas: ['mnadvocacia.com.br', 'justen.com.br']
  },
  FILTROS_BOOLEANOS: {
    pregaoEletronico: { 
      obrigatorio: ['pregão eletrônico', 'pregão', 'pregao eletronico', 'pregao'], 
      combinadoCom: ['edital', 'termo de referência', 'termo de referencia', 'minuta de contrato', 'ata de registro de preços', 'ata de registro de precos'] 
    },
    licitacaoProblematica: { 
      obrigatorio: ['licitação', 'licitacao'], 
      combinadoCom: ['impugnação de edital', 'impugnacao de edital', 'suspensão do certame', 'suspensao do certame', 'revogação', 'revogacao', 'anulação', 'anulacao'] 
    },
    dispensaLicitacao: { 
      obrigatorio: ['dispensa de licitação', 'dispensa de licitacao', 'dispensa'], 
      combinadoCom: ['justificativa', 'pesquisa de preços', 'pesquisa de precos', 'ratificação', 'ratificacao', 'parecer jurídico', 'parecer juridico'] 
    },
    inexigibilidade: { 
      obrigatorio: ['inexigibilidade'], 
      combinadoCom: ['contratação direta', 'contratacao direta', 'justificativa', 'parecer jurídico', 'parecer juridico'] 
    },
    mandadoSeguranca: { 
      obrigatorio: ['mandado de segurança', 'mandado de seguranca', 'MS'], 
      combinadoCom: ['pregão', 'pregao', 'licitação', 'licitacao', 'desclassificação', 'desclassificacao', 'inabilitação', 'inabilitacao'] 
    }
  },
  AUTORES: [
    'Flávio Amaral Garcia', 'Ronny Charles Lopes de Torres', 'Joel de Menezes Niebuhr',
    'Jorge Ulisses Jacoby Fernandes', 'Murilo Jacoby', 'Ana Luiza Jacoby Fernandes',
    'Tatiana Camarão', 'Jair Eduardo Santana', 'Sidney Bittencourt',
    'Jessé Torres Pereira Junior', 'Marinês Dotti', 'Maria Sylvia Zanella di Pietro',
    'Celso Antônio Bandeira de Mello', 'José dos Santos Carvalho Filho', 'Rafael Carvalho',
    'Pedro Niebuhr', 'Gustavo Ramos da Silva Quint', 'Luiz Eduardo Altenburg de Assis',
    'Otávio Sendtko Ferreira', 'Cristiane Fortini', 'Renato Fenili', 'Andrea Ache', 
    'Alessandra Obara', 'Inês Maria dos Santos Coimbra'
  ]
};

// =====================
// PARSER DE RSS/XML
// =====================
async function parseRSSFeed(url, fonte) {
  try {
    console.log(`📡 Tentando buscar feed RSS: ${fonte}`);
    const { data } = await axios.get(url, { 
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const $ = cheerio.load(data, { xmlMode: true });
    const items = [];
    
    $('item').each((i, item) => {
      if (i < 5) { // Limitar aos 5 mais recentes
        const titulo = $(item).find('title').text().trim();
        const link = $(item).find('link').text().trim() || $(item).find('guid').text().trim();
        const descricao = $(item).find('description').text().trim();
        const dataPub = $(item).find('pubDate').text().trim() || 
                       $(item).find('dc\\:date').text().trim() ||
                       $(item).find('date').text().trim();
        
        if (titulo) {
          items.push({
            titulo,
            link,
            descricao: descricao.substring(0, 200),
            data: dataPub ? new Date(dataPub).toLocaleDateString('pt-BR') : 'Data não disponível'
          });
        }
      }
    });
    
    if (items.length === 0) {
      console.log(`⚠️ Nenhum item encontrado no feed RSS de ${fonte}`);
      return null;
    }
    
    console.log(`✅ ${fonte}: ${items.length} itens encontrados via RSS`);
    return items;
  } catch (error) {
    console.error(`❌ Erro ao buscar RSS de ${fonte}:`, error.message);
    return null;
  }
}

// =====================
// FEEDS TCU
// =====================
async function buscarFeedTCUInformativoLicitacoes() {
  const urlsPossiveis = [
    'https://portal.tcu.gov.br/RSS/informativo-de-licitacoes-e-contratos.xml',
    'https://portal.tcu.gov.br/rss/informativo-licitacoes.xml',
    'https://portal.tcu.gov.br/rss/informativo-de-licitacoes-e-contratos.xml'
  ];
  
  for (const url of urlsPossiveis) {
    const resultado = await parseRSSFeed(url, 'TCU Informativo de Licitações');
    if (resultado) {
      return resultado.map(item => 
        `• ${item.titulo} (${item.data})\n  ${item.descricao}...\n  ${item.link}`
      ).join('\n\n');
    }
  }
  
  // Fallback: scraping direto se RSS falhar
  return await scrapeTCUInformativo();
}

async function buscarFeedTCUBoletimJurisprudencia() {
  const urlsPossiveis = [
    'https://portal.tcu.gov.br/RSS/boletim-de-jurisprudencia.xml',
    'https://portal.tcu.gov.br/rss/boletim-jurisprudencia.xml'
  ];
  
  for (const url of urlsPossiveis) {
    const resultado = await parseRSSFeed(url, 'TCU Boletim de Jurisprudência');
    if (resultado) {
      return resultado.map(item => 
        `• ${item.titulo} (${item.data})\n  ${item.link}`
      ).join('\n\n');
    }
  }
  
  return 'Feed RSS do Boletim de Jurisprudência TCU temporariamente indisponível.';
}

// =====================
// FEEDS TCE-SP
// =====================
async function buscarFeedTCESPBoletim() {
  const urlsPossiveis = [
    'https://www.tce.sp.gov.br/rss/boletim-jurisprudencia',
    'https://www.tce.sp.gov.br/rss/boletim',
    'https://www.tce.sp.gov.br/feed/boletim'
  ];
  
  for (const url of urlsPossiveis) {
    const resultado = await parseRSSFeed(url, 'TCE-SP Boletim');
    if (resultado) {
      return resultado.map(item => 
        `• ${item.titulo} (${item.data})\n  ${item.link}`
      ).join('\n\n');
    }
  }
  
  // Fallback: scraping direto se RSS falhar
  return await scrapeTCESPBoletins();
}

// =====================
// SCRAPING TCE-SP (Fallback)
// =====================
async function scrapeTCESPNoticias() {
  try {
    const { data } = await axios.get('https://www.tce.sp.gov.br/noticias', { timeout: 10000 });
    const $ = cheerio.load(data);
    const noticias = [];
    $('.noticiaBox, .news-box, .noticia-item').slice(0, 5).each((i, el) => {
      let titulo = $(el).find('a').text().trim() || $(el).find('h2, h3').text().trim();
      if (!titulo) titulo = $(el).text().trim().split('\n')[0];
      let link = $(el).find('a').attr('href');
      if (link && !link.startsWith('http')) link = 'https://www.tce.sp.gov.br' + link;
      let dataPub = $(el).find('.date, .noticiaData, .data').text().trim();
      if (titulo && link) noticias.push(`• ${titulo}${dataPub ? ` (${dataPub})` : ''}\n  ${link}`);
    });
    return noticias.length > 0 ? noticias.join('\n\n') : 'Nenhuma notícia recente no TCE-SP.';
  } catch (e) {
    console.error('Erro TCE-SP notícias:', e.message);
    return 'Erro ao acessar notícias do TCE-SP.';
  }
}

async function scrapeTCESPBoletins() {
  const urls = [
    'https://www.tce.sp.gov.br/boletim',
    'https://www.tce.sp.gov.br/publicacoes/boletim',
    'https://www4.tce.sp.gov.br/publicacoes/boletins'
  ];
  
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(data);
      const boletins = [];
      
      const linhas = $('.views-table tr, table tr, .boletim-item, .publicacao-item');
      
      linhas.slice(1, 4).each((_, el) => {
        const celulas = $(el).find('td');
        if (celulas.length >= 2) {
          const dataBoletim = $(celulas[0]).text().trim();
          const titulo = $(celulas[1]).text().trim();
          let link = $(celulas[1]).find('a').attr('href');
          if (link && !link.startsWith('http')) link = 'https://www.tce.sp.gov.br' + link;
          if (titulo && link) boletins.push(`• ${titulo} (${dataBoletim})\n  ${link}`);
        } else {
          const titulo = $(el).find('a, h3, h2').text().trim();
          let link = $(el).find('a').attr('href');
          if (link && !link.startsWith('http')) link = 'https://www.tce.sp.gov.br' + link;
          if (titulo && link) boletins.push(`• ${titulo}\n  ${link}`);
        }
      });
      
      if (boletins.length > 0) return boletins.join('\n\n');
    } catch (e) {
      console.error(`Tentativa falhou em ${url}:`, e.message);
      continue;
    }
  }
  
  return 'Nenhum boletim recente localizado no TCE-SP.';
}

// =====================
// SCRAPING TCU (Fallback)
// =====================
async function scrapeTCUNoticias() {
  try {
    const { data } = await axios.get('https://portal.tcu.gov.br/imprensa/noticias', { timeout: 10000 });
    const $ = cheerio.load(data);
    const noticias = [];
    $('.noticia-item, .news-item').slice(0, 5).each((i, el) => {
      const titulo = $(el).find('.noticia-titulo, h2, h3').text().trim();
      let link = $(el).find('a').attr('href');
      if (link && !link.startsWith('http')) link = 'https://portal.tcu.gov.br' + link;
      const dataPub = $(el).find('.noticia-data, .data').text().trim();
      if (titulo && link) noticias.push(`• ${titulo}${dataPub ? ` (${dataPub})` : ''}\n  ${link}`);
    });
    return noticias.length > 0 ? noticias.join('\n\n') : 'Nenhuma notícia recente no TCU.';
  } catch (e) {
    console.error('Erro TCU notícias:', e.message);
    return 'Erro ao acessar notícias do TCU.';
  }
}

async function scrapeTCUInformativo() {
  try {
    const { data } = await axios.get('https://portal.tcu.gov.br/jurisprudencia/boletins-e-informativos/informativo-de-licitacoes-e-contratos.htm', { timeout: 10000 });
    const $ = cheerio.load(data);
    const informativos = [];
    $('.boxMateria, article, .informativo').slice(0, 3).each((i, el) => {
      const titulo = $(el).find('h2, h3').first().text().trim() || 'Informativo TCU';
      const texto = $(el).find('p').first().text().trim();
      let link = $(el).find('a').first().attr('href') || 'https://portal.tcu.gov.br/jurisprudencia/boletins-e-informativos/informativo-de-licitacoes-e-contratos.htm';
      if (link && !link.startsWith('http')) link = 'https://portal.tcu.gov.br' + link;
      if (titulo) informativos.push(`• ${titulo}\n  ${texto.substring(0, 200)}...\n  ${link}`);
    });
    return informativos.length > 0 ? informativos.join('\n\n') : 'Nenhum informativo recente do TCU localizado.';
  } catch (e) {
    console.error('Erro TCU informativo:', e.message);
    return 'Erro ao acessar informativo do TCU.';
  }
}

// =====================
// SCRAPING OUTROS ÓRGÃOS
// =====================
async function scrapeAGU() {
  try {
    const { data } = await axios.get('https://www.gov.br/agu/pt-br/composicao/cgu/cgu/noticias', { timeout: 10000 });
    const $ = cheerio.load(data);
    const noticias = [];
    $('.item, .news-item').slice(0, 5).each((i, el) => {
      const titulo = $(el).find('h2, h3').text().trim();
      let link = $(el).find('a').attr('href');
      if (link && !link.startsWith('http')) link = 'https://www.gov.br' + link;
      const dataPub = $(el).find('.documentByLine, .data').text().trim();
      if (titulo && link) noticias.push({ titulo, link, data: dataPub, orgao: 'AGU' });
    });
    return noticias.length > 0 ? noticias : [{ titulo: 'Nenhuma novidade relevante nas últimas 24h', orgao: 'AGU' }];
  } catch (e) {
    console.error('Erro AGU:', e.message);
    return [{ titulo: 'Erro ao acessar o site da AGU', orgao: 'AGU' }];
  }
}

async function scrapeSTJ() {
  try {
    const { data } = await axios.get('https://www.stj.jus.br/sites/portalp/Comunicacao/Ultimas-noticias', { timeout: 10000 });
    const $ = cheerio.load(data);
    const noticias = [];
    $('.noticia, .news-item').slice(0, 5).each((i, el) => {
      const titulo = $(el).find('h3, h2').text().trim();
      let link = $(el).find('a').attr('href');
      if (link && !link.startsWith('http')) link = 'https://www.stj.jus.br' + link;
      const dataPub = $(el).find('.data').text().trim();
      if (titulo && link) noticias.push({ titulo, link, data: dataPub, orgao: 'STJ' });
    });
    return noticias.length > 0 ? noticias : [{ titulo: 'Nenhuma novidade relevante nas últimas 24h', orgao: 'STJ' }];
  } catch (e) {
    console.error('Erro STJ:', e.message);
    return [{ titulo: 'Erro ao acessar o site do STJ', orgao: 'STJ' }];
  }
}

async function scrapeTJSP() {
  try {
    const { data } = await axios.get('https://www.tjsp.jus.br/Noticias', { timeout: 10000 });
    const $ = cheerio.load(data);
    const noticias = [];
    $('.resultado-pesquisa, .noticia').slice(0, 5).each((i, el) => {
      const titulo = $(el).find('.titulo-noticia, h2, h3').text().trim();
      let link = $(el).find('a').attr('href');
      if (link && !link.startsWith('http')) link = 'https://www.tjsp.jus.br' + link;
      const dataPub = $(el).find('.data-noticia, .data').text().trim();
      if (titulo && link) noticias.push({ titulo, link, data: dataPub, orgao: 'TJSP' });
    });
    return noticias.length > 0 ? noticias : [{ titulo: 'Nenhuma novidade relevante nas últimas 24h', orgao: 'TJSP' }];
  } catch (e) {
    console.error('Erro TJSP:', e.message);
    return [{ titulo: 'Erro ao acessar o site do TJSP', orgao: 'TJSP' }];
  }
}

async function buscarInformativosOficiais() {
  console.log('📰 Buscando informativos oficiais via scraping...');
  const [agu, stj, tjsp] = await Promise.all([scrapeAGU(), scrapeSTJ(), scrapeTJSP()]);
  const todas = [...agu, ...stj, ...tjsp];
  let texto = '';
  todas.forEach(noticia => {
    if (noticia.link) {
      texto += `• ${noticia.titulo} ${noticia.data ? `(${noticia.data})` : ''} – ${noticia.orgao}\n  ${noticia.link}\n\n`;
    } else {
      texto += `• ${noticia.titulo} – ${noticia.orgao}\n\n`;
    }
  });
  return texto || 'Nenhum informativo relevante nas últimas 24 horas.';
}

// =====================
// FUNÇÕES AUXILIARES
// =====================
function atendeFiltrosBooleanos(texto) {
  if (!texto) return { atende: false, grupos: [] };
  const textoLower = texto.toLowerCase();
  const gruposAtendidos = [];
  for (const [nomeGrupo, filtro] of Object.entries(CONFIG.FILTROS_BOOLEANOS)) {
    if (!filtro.obrigatorio.some(palavra => textoLower.includes(palavra))) continue;
    if (filtro.combinadoCom.some(palavra => textoLower.includes(palavra))) gruposAtendidos.push(nomeGrupo);
  }
  return { atende: gruposAtendidos.length > 0, grupos: gruposAtendidos };
}

function formatarGruposFiltros(grupos) {
  const nomes = {
    pregaoEletronico: '📋 Pregão Eletrônico',
    licitacaoProblematica: '⚠️ Problemas em Licitação',
    dispensaLicitacao: '📄 Dispensa',
    inexigibilidade: '🔓 Inexigibilidade',
    mandadoSeguranca: '⚖️ Mandado de Segurança'
  };
  return grupos.map(g => nomes[g] || g).join(', ');
}

async function buscarPerplexity(prompt, fontes = null) {
  try {
    const promptLimitado = prompt.length > 2000 ? prompt.substring(0, 2000) + '...' : prompt;
    
    const body = {
      model: 'sonar',
      messages: [
        { 
          role: 'system', 
          content: 'Você é um assistente especialista em licitações, contratos e direito público. Seja objetivo, factual e direto. NÃO explique contextos gerais, apenas liste resultados concretos com data, fonte e link.' 
        },
        { role: 'user', content: promptLimitado }
      ],
      return_citations: true,
      max_tokens: 2000
    };
    
    if (fontes && fontes.length > 0) {
      const fontesValidas = fontes.filter(f => f && typeof f === 'string' && f.length > 0).slice(0, 20);
      if (fontesValidas.length > 0) {
        body.search_domain_filter = fontesValidas;
      }
    }
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erro ${response.status} da API Perplexity:`, errorText);
      throw new Error(`Erro na API Perplexity: ${response.status}`);
    }
    
    const data = await response.json();
    return { 
      sucesso: true, 
      conteudo: data.choices[0].message.content, 
      citacoes: data.citations || [] 
    };
  } catch (erro) {
    console.error('❌ Erro Perplexity:', erro.message);
    return { 
      sucesso: false, 
      conteudo: 'Informação temporariamente indisponível (erro na busca).', 
      erro: erro.message 
    };
  }
}

// =====================
// BUSCAS TEMÁTICAS (mantidas do código anterior)
// =====================
async function buscarPNCP() {
  const prompt = `Liste SOMENTE licitações publicadas no PNCP nas últimas 24 horas que sejam: modalidades especiais (Diálogo Competitivo, PPP, Concessão, PMI, RDC) OU valor > 100 milhões OU grandes projetos (infraestrutura, saúde, tecnologia, energia, PD&I). Formato: • Título (data, modalidade) – Órgão, Valor, objeto, Link PNCP. Se não houver: "Nenhuma licitação especial relevante."`;
  return await buscarPerplexity(prompt, CONFIG.FONTES.pncp);
}

async function buscarComprasSPComprasNet() {
  const prompt = `Liste comunicados, notícias e atualizações da SGGD/SP publicados no Compras.sp e ComprasNet/Compras.gov.br NAS ÚLTIMAS 24H. Inclua: comunicados SGGD/SILOG, mudanças em sistemas, instruções Lei 14.133, índices de reajuste, centralizações. Formato: • Título (data) – Órgão/Portal, Resumo 1 linha, Link. Se não houver: "Nenhuma novidade."`;
  return await buscarPerplexity(prompt, [...CONFIG.FONTES.comprasPublicas, 'compras.sp.gov.br', 'sggd.sp.gov.br']);
}

async function buscarAtosNormativos() {
  const prompt = `Liste atos normativos federais e de SP publicados/modificados NAS ÚLTIMAS 24H sobre Lei 14.133/2021: INs, Decretos, Portarias, Resoluções, atualizações de valores/índices/procedimentos. Formato: • Título (data) – Órgão, Resumo 1 linha, Link oficial (DOE/DOU). Se não houver: "Nenhum ato relevante."`;
  return await buscarPerplexity(prompt, CONFIG.FONTES.legislacao);
}

async function buscarDecisoesJudiciais() {
  const prompt = `Liste decisões judiciais sobre incidentes em licitações/contratos das últimas 24h. Tribunais: STF, STJ, TRFs, TJs, TCU, TCEs. Temas: MS, suspensão, fraude, anulação, multas. Formato: • Título (data) – Tribunal, Resumo 2 linhas, Link. Se não houver: "Nenhuma decisão relevante."`;
  return await buscarPerplexity(prompt, ['stf.jus.br', 'stj.jus.br', 'tjsp.jus.br', 'tcu.gov.br', 'tce.sp.gov.br', 'jota.info', 'conjur.com.br', 'migalhas.com.br']);
}

async function buscarLicitacoesContratos() {
  const prompt = `Liste informações sobre licitações, contratos e contratações públicas NAS ÚLTIMAS 24H: repactuação, reequilíbrio, Diálogo Competitivo, PD&I, Marco Legal Inovação, PPPs, Concessões, Contratos Grande Vulto, Lei 14.133, compras estratégicas. Formato: • Título (data) – Fonte/Órgão, Resumo 2 linhas, Link. Se não houver: "Nenhuma novidade."`;
  return await buscarPerplexity(prompt, [...CONFIG.FONTES.orgaosJuridicos, ...CONFIG.FONTES.comprasPublicas, 'zenite.com.br', 'ronnycharles.com.br', 'jota.info', 'conjur.com.br', ...CONFIG.FONTES.especialistas]);
}

async function buscarReformaTributaria() {
  const prompt = `Liste notícias sobre reforma tributária (CBS/IBS) e impactos em contratos públicos das últimas 24h: repactuação, reequilíbrio, pareceres TCU/AGU, decisões judiciais. Formato: • Título (data) – Fonte, Resumo 2 linhas, Link. Se não houver: "Nenhuma novidade."`;
  return await buscarPerplexity(prompt, ['tcu.gov.br', 'agu.gov.br', 'zenite.com.br', 'ronnycharles.com.br', 'jota.info', 'conjur.com.br', 'receita.economia.gov.br']);
}

async function buscarEventos() {
  const nomesChave = CONFIG.AUTORES.join(', ');
  const prompt = `Liste eventos, congressos, seminários, webinares e cursos sobre licitações, contratos e contratações públicas nos PRÓXIMOS 180 DIAS. Priorize eventos com: ${nomesChave}. Formato: • Nome (data, local/online) – Instituição, Em especial com: [palestrantes-chave confirmados], Link inscrição. Só cite palestrantes se confirmados. Se não houver: "Nenhum evento relevante."`;
  return await buscarPerplexity(prompt, CONFIG.FONTES.eventos);
}

async function buscarPeriodicosArtigos() {
  const autores = CONFIG.AUTORES.join(', ');
  const prompt = `Liste artigos, pareceres, livros e publicações NAS ÚLTIMAS 24H de: ${autores}. Formato: • Título (data) – Autor(es), Fonte/Periódico, Link. Se não houver: "Nenhum artigo relevante."`;
  return await buscarPerplexity(prompt, CONFIG.FONTES.periodicos);
}

async function buscarRonnyCharles() {
  const prompt = `Liste publicações, artigos, notícias e atualizações NAS ÚLTIMAS 24H em ronnycharles.com.br. Formato: • Título (data), Resumo 1 linha, Link. Se não houver: "Nenhuma novidade."`;
  return await buscarPerplexity(prompt, ['ronnycharles.com.br']);
}

async function buscarZenite() {
  const prompt = `Liste publicações, artigos, vídeos, comunicados e atualizações NAS ÚLTIMAS 24H em zenite.com.br. Formato: • Título (data), Resumo 1 linha, Link. Se não houver: "Nenhuma novidade."`;
  return await buscarPerplexity(prompt, ['zenite.com.br']);
}

// =====================
// RELATÓRIO FINAL
// =====================
async function montarEEnviarRelatorio() {
  console.log('🚀 Gerando relatório completo com feeds RSS...');

  const [
    noticiasTCESP, 
    boletinsTCESPFeed,
    noticiasTCU, 
    informativoTCUFeed,
    boletimTCUFeed,
    pncp, comprasSP, atos, eventos, periodicos, ronny, zenite,
    informativos, licitacoesContratos, reformaTributaria, decisoes
  ] = await Promise.all([
    scrapeTCESPNoticias(),
    buscarFeedTCESPBoletim(),
    scrapeTCUNoticias(),
    buscarFeedTCUInformativoLicitacoes(),
    buscarFeedTCUBoletimJurisprudencia(),
    buscarPNCP(),
    buscarComprasSPComprasNet(),
    buscarAtosNormativos(),
    buscarEventos(),
    buscarPeriodicosArtigos(),
    buscarRonnyCharles(),
    buscarZenite(),
    buscarInformativosOficiais(),
    buscarLicitacoesContratos(),
    buscarReformaTributaria(),
    buscarDecisoesJudiciais()
  ]);

  let texto = `
═════════📋 LICITAÇÕES ESPECIAIS PNCP═════════
${pncp.conteudo || 'Nenhum resultado.'}

═════════🛒 COMPRAS.SP & COMPRASNET - SGGD═════════
${comprasSP.conteudo || 'Nenhum resultado.'}

═════════📑 ATOS NORMATIVOS (Lei 14.133)═════════
${atos.conteudo || 'Nenhum resultado.'}

═════════🟦 TCE-SP – NOTÍCIAS═════════
${noticiasTCESP}

═════════📄 TCE-SP – BOLETIM DE JURISPRUDÊNCIA (Feed RSS)═════════
${boletinsTCESPFeed}

═════════🟣 TCU – NOTÍCIAS═════════
${noticiasTCU}

═════════📘 TCU – INFORMATIVO DE LICITAÇÕES E CONTRATOS (Feed RSS)═════════
${informativoTCUFeed}

═════════📗 TCU – BOLETIM DE JURISPRUDÊNCIA (Feed RSS)═════════
${boletimTCUFeed}

═════════⚖️ DECISÕES JUDICIAIS E TRIBUNAIS DE CONTAS═════════
${decisoes.conteudo || 'Nenhum resultado.'}

═════════💼 LICITAÇÕES, CONTRATOS, PD&I & INOVAÇÃO═════════
${licitacoesContratos.conteudo || 'Nenhum resultado.'}

═════════📊 REFORMA TRIBUTÁRIA – Contratos & Impactos═════════
${reformaTributaria.conteudo || 'Nenhum resultado.'}

═════════🎓 EVENTOS & CURSOS (180 dias)═════════
${eventos.conteudo || 'Nenhum resultado.'}

═════════📰 ARTIGOS E AUTORES═════════
${periodicos.conteudo || 'Nenhum resultado.'}

═════════🔶 RONNY CHARLES═════════
${ronny.conteudo || 'Nenhum resultado.'}

═════════🔵 ZÊNITE═════════
${zenite.conteudo || 'Nenhum resultado.'}

═════════ℹ️ INFORMATIVOS OFICIAIS (AGU, STJ, TJSP)═════════
${informativos}
`;

  const todosFiltros = [
    pncp.conteudo, atos.conteudo, decisoes.conteudo, licitacoesContratos.conteudo,
    noticiasTCESP, boletinsTCESPFeed, noticiasTCU, informativoTCUFeed
  ].filter(Boolean).join('\n');
  
  const analise = atendeFiltrosBooleanos(todosFiltros);

  let filtrosHTML = '';
  if (analise.atende) {
    const gruposFormatados = formatarGruposFiltros(analise.grupos);
    filtrosHTML = `<div style="background:#e8f5e9;border-left:4px solid #4caf50;padding:15px;margin:20px 0;border-radius:4px;">
    <strong style="color:#2e7d32;">🎯 Filtros Booleanos Identificados:</strong><br>${gruposFormatados}</div>`;
  }

const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  secure: false,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY
  }
});

  const corpoEmail = `
  <html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <div style="background:linear-gradient(135deg,#134252 0%,#1a5666 100%);color:white;padding:25px;text-align:center;">
      <h1>Clipping Executivo - Licitações, Contratos, Compras Públicas e Inovação</h1>
      <p style="margin:10px 0 5px 0;font-size:14px;opacity:0.95;">Promovido pelo NLC/PGE/SP</p>
      <p style="margin:5px 0;">${new Date().toLocaleString('pt-BR')}</p>
      <span style="display:inline-block;padding:4px 12px;border-radius:12px;background:#e8f5e9;color:#2e7d32;">
        📡 Scraping + RSS Feeds + IA + Filtros</span>
    </div>
    <div style="padding:25px;background:white;">
      ${filtrosHTML}
      <pre style="background:#f8f9fa;padding:20px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;font-size:13px;line-height:1.6;">${texto}</pre>
    </div>
    <div style="background:#f4f4f4;padding:18px;text-align:center;font-size:12px;color:#666;">
      Sistema automatizado com RSS feeds | Powered by Perplexity AI + Web Scraping<br>
      📡 TCE-SP Feed • TCU Feed • ComprasSP • Lei 14.133 • PD&I • Reforma Tributária
    </div>
  </body>
  </html>`;

  try {
    await transporter.sendMail({
      from: `"Clipping NLC/PGE/SP" <${CONFIG.EMAIL.from}>`,
      to: CONFIG.EMAIL.to,
      subject: `📡 Clipping Executivo com RSS Feeds – ${new Date().toLocaleDateString('pt-BR')}`,
      html: corpoEmail
    });
    console.log('✅ Relatório enviado com sucesso!');
  } catch (erro) {
    console.error('❌ Erro ao enviar e-mail:', erro.message);
  }
}

// =====================
// API & INICIALIZAÇÃO
// =====================
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Clipping Executivo NLC/PGE/SP',
    version: '12.0-RSS-Feeds',
    features: ['RSS TCU', 'RSS TCE-SP', 'Scraping', 'Perplexity AI', 'Filtros Booleanos'],
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/saude', (req, res) => res.json({ 
  status: 'ok', 
  version: '12.0-RSS-Feeds', 
  features: [
    'rss-tcu-informativo-licitacoes',
    'rss-tcu-boletim-jurisprudencia',
    'rss-tce-sp-boletim',
    'pncp-licitacoes-especiais',
    'compras-sp-comprasnet',
    'atos-lei14133',
    'tce-sp-scraping',
    'tcu-scraping',
    'decisoes-judiciais',
    'licitacoes-contratos-pdi',
    'reforma-tributaria',
    'eventos-autores',
    'artigos-periodicos',
    'sites-especializados',
    'filtros-booleanos'
  ],
  serverTime: new Date().toISOString() 
}));

app.get('/run-scraping', async (req, res) => {
  console.log('📍 Scraping manual iniciado');
  try {
    await montarEEnviarRelatorio();
    res.json({ 
      success: true, 
      message: 'Relatório gerado e enviado com sucesso (com RSS feeds)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Erro no scraping manual:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

function iniciarSistema() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('\n╔═══════════════════════════════════════════════╗');
    console.log('║  🎯 CLIPPING EXECUTIVO v12.0 - RSS FEEDS     ║');
    console.log('║     NLC/PGE/SP - Sistema Profissional        ║');
    console.log('║     📡 TCU + TCE-SP RSS Integration          ║');
    console.log('╚═══════════════════════════════════════════════╝\n');
    console.log(`🌐 Servidor rodando em: http://localhost:${PORT}`);
    console.log(`📊 API de Saúde: http://localhost:${PORT}/api/saude`);
    console.log(`🔧 Teste manual: http://localhost:${PORT}/run-scraping\n`);
  });

  // Cron job - executa todo dia às 7h AM
  cron.schedule('0 7 * * *', () => { 
    console.log('⏰ Executando clipping agendado com RSS feeds...');
    montarEEnviarRelatorio(); 
  }, { timezone: 'America/Sao_Paulo' });
  
  console.log('⏰ Clipping agendado para rodar todos os dias às 7:00 AM (Brasília)');
  console.log('📡 Incluindo feeds RSS do TCU e TCE-SP\n');
  
  // TESTE IMEDIATO - apenas em desenvolvimento
  if (process.env.NODE_ENV !== 'production') {
    console.log('🧪 Modo desenvolvimento: executando teste em 10 segundos...\n');
    setTimeout(() => {
      montarEEnviarRelatorio();
    }, 10000);
  } else {
    console.log('📌 Modo produção: aguardando horário agendado (7h AM)\n');
  }
}

iniciarSistema();


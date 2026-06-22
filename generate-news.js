// Genera articoli per il blog di GiGaWeb ricercando sul web con Gemini (Google Search grounding):
// un mix quotidiano di news AI, notizie sul mondo dei siti web, un consiglio del giorno e una guida
// tool, pubblicati come articoli WordPress su gigawebagency.it. Pensato per essere eseguito ogni
// giorno da GitHub Actions (vedi .github/workflows/daily-news.yml), ma funziona anche in locale.
//
// Genera un articolo alla volta (non un unico JSON con piu' articoli): e' molto piu' affidabile con
// un modello come Gemini, evita problemi di escaping JSON con contenuto HTML, e se un articolo
// fallisce gli altri vengono pubblicati comunque.

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const WP_USER = process.env.WP_USER
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD
const WP_BASE = 'https://gigawebagency.it/wp-json/wp/v2'

const CATEGORY_IDS = {
  news_ai: 82,
  models: 83,
  agents: 84,
  security: 85,
  tools: 86,
  research: 87,
  websites: 88,
  tips: 89,
  toolguides: 90
}

if (!GEMINI_API_KEY || !WP_USER || !WP_APP_PASSWORD) {
  console.error('Variabili d\'ambiente mancanti: GEMINI_API_KEY, WP_USER, WP_APP_PASSWORD sono obbligatorie.')
  process.exit(1)
}

const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64')

async function fetchWithRetry(url, options, retries = 3) {
  let lastRes
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, options)
    if (res.ok) return res
    lastRes = res
    const retriable = res.status === 503 || res.status === 429 || res.status >= 500
    if (!retriable || attempt === retries) return res
    const wait = attempt * 5000
    console.log(`  Risposta ${res.status}, ritento in ${wait / 1000}s (tentativo ${attempt}/${retries})...`)
    await new Promise(r => setTimeout(r, wait))
  }
  return lastRes
}

function slugify(text) {
  return text.toString().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}

async function getRecentTitles() {
  const res = await fetch(`${WP_BASE}/posts?categories=${CATEGORY_IDS.news_ai}&per_page=20&_fields=title`, {
    headers: { Authorization: authHeader }
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.map(p => p.title.rendered)
}

// Le 4 "fette" di contenuto generate ogni giorno, come richiesto: AI, mondo dei siti, consiglio
// del giorno, guida tool. Ognuna e' una chiamata indipendente e ricercata sul web separatamente.
function buildSlots() {
  return [
    {
      category: 'ai',
      categoryIds: ['models', 'agents', 'security', 'research'],
      instructions: `Cerca sul web le ultime notizie sull'intelligenza artificiale delle ultime 24-48 ore (nuovi modelli come Claude/GPT/Gemini/DeepSeek/Llama, agenti AI e tool come Cursor/Claude Code, sicurezza AI, oppure ricerca/paper rilevanti). Scegli LA notizia piu' interessante e scrivi un articolo di news su quella.`
    },
    {
      category: 'websites',
      categoryIds: ['websites'],
      instructions: `Cerca sul web notizie o tendenze recenti sul mondo dei siti web e del digitale per piccole imprese (web design, e-commerce, SEO, normative come GDPR/cookie, social media, marketing online, Google aggiornamenti algoritmo). Scrivi un articolo di news/approfondimento su quella.`
    },
    {
      category: 'tips',
      categoryIds: ['tips'],
      instructions: `Scrivi un CONSIGLIO pratico del giorno per chi gestisce un sito web o un'attivita' online (piccolo suggerimento concreto e immediatamente applicabile: velocita' del sito, SEO, conversioni, sicurezza, contenuti, email marketing, ecc.). Puoi basarti su buone pratiche consolidate, ma se utile verifica sul web eventuali aggiornamenti recenti sul tema scelto.`
    },
    {
      category: 'toolguides',
      categoryIds: ['toolguides'],
      instructions: `Cerca sul web e scrivi una GUIDA pratica introduttiva su uno strumento utile per chi gestisce un sito web (es. Google Search Console, Google Analytics, un plugin WordPress popolare, uno strumento SEO o di sicurezza, uno strumento di performance/velocita'). Spiega cosa fa lo strumento e come iniziare a usarlo, con 2-3 consigli pratici.`
    }
  ]
}

async function generateOneArticle(slot, existingTitles) {
  const prompt = `Sei il redattore del blog di GiGaWeb, un'agenzia web italiana (creazione siti, e-commerce, assistenza, e soluzioni AI per le aziende). Scrivi in italiano per i clienti e potenziali clienti dell'agenzia: piccole imprese e professionisti che vogliono capire l'AI e il mondo del web, senza tecnicismi eccessivi.

# Compito
${slot.instructions}

# Vincoli importanti
- IGNORA argomenti equivalenti a questi gia' pubblicati di recente:
${existingTitles.map(t => `  - ${t}`).join('\n') || '  (nessuno)'}
- Mai inventare informazioni: usa solo quanto trovi con la ricerca
- Articolo ORIGINALE, tono professionale ma accessibile, niente parafrasi pedissequa
- 400-700 parole, in HTML semplice: SOLO i tag <h2>, <p>, <strong>, <ul>, <li> (NESSUN markdown, NESSUN tag html/head/body, NESSUN ritorno a capo letterale dentro un paragrafo)
- Scegli 1 sola categoria tra: ${slot.categoryIds.join(', ')}
- Scegli 1 emoji singola che rappresenti l'articolo
- Scegli 3-5 tag brevi (singole parole o frasi corte)

# Formato di risposta (esattamente questo, senza markdown/backtick, ogni campo su una riga eccetto CONTENT che e' l'ultimo campo e va fino alla fine)
TITLE: <titolo accattivante, max 80 caratteri>
SUMMARY: <sommario di 1-2 frasi, max 200 caratteri>
EMOJI: <una sola emoji>
CATEGORY: <una tra ${slot.categoryIds.join(', ')}>
TAGS: <tag1, tag2, tag3>
READINGTIME: <numero minuti, es 4>
CONTENT: <HTML dell'articolo, tutto su un'unica riga continua>`

  const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
    })
  })
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const data = await res.json()
  const candidate = data.candidates?.[0]
  if (!candidate) throw new Error('Nessuna risposta da Gemini: ' + JSON.stringify(data).slice(0, 500))
  const text = (candidate.content?.parts || []).filter(p => p.text).map(p => p.text).join('\n').trim()

  return parseArticleText(text, slot)
}

function parseArticleText(text, slot) {
  function field(name) {
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'm')
    const m = text.match(re)
    return m ? m[1].trim() : ''
  }

  const title = field('TITLE')
  const summary = field('SUMMARY')
  const emoji = field('EMOJI') || '🤖'
  let category = field('CATEGORY').toLowerCase()
  if (!CATEGORY_IDS[category]) category = slot.categoryIds[0]
  const tags = field('TAGS').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
  const readingTime = parseInt(field('READINGTIME'), 10) || 4

  const contentIdx = text.indexOf('CONTENT:')
  const content = contentIdx >= 0 ? text.slice(contentIdx + 'CONTENT:'.length).trim() : ''

  if (!title || !content) throw new Error('Risposta non nel formato atteso:\n' + text.slice(0, 800))

  return { title, summary, content, category, tags, cover_emoji: emoji, reading_time: readingTime }
}

async function getOrCreateTagId(name) {
  const search = await fetch(`${WP_BASE}/tags?search=${encodeURIComponent(name)}`, {
    headers: { Authorization: authHeader }
  })
  const found = await search.json()
  const exact = (found || []).find(t => t.name.toLowerCase() === name.toLowerCase())
  if (exact) return exact.id

  const create = await fetch(`${WP_BASE}/tags`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
  const data = await create.json()
  if (create.ok) return data.id
  if (data.data?.term_id) return data.data.term_id
  return null
}

// Corregge lo sfondo scuro del banner titolo/navigazione articolo del tema (lo rende chiaro) e
// traduce in italiano le etichette del modulo commenti, che il tema lascia hardcoded in inglese.
// Incollato direttamente nel contenuto (non in un widget di sidebar): i widget della sidebar del
// blog si sono dimostrati instabili (un widget creato via REST si è "staccato" da solo due volte),
// mentre il contenuto del post renderizza sempre, a prescindere dal layout sidebar/no-sidebar.
const FIX_BLOCK = `<style>
body.single-post .tp-breadcrumb-area.tp-custom-breadcrumb-bg { background: #f7f9ff !important; }
body.single-post .tp-breadcrumb-content,
body.single-post .tp-breadcrumb-title,
body.single-post .tp-breadcrumb-list,
body.single-post .tp-breadcrumb-list span,
body.single-post .tp-breadcrumb-list a { color: #1f2330 !important; }
body.single-post .tp-breadcrumb-list a:hover { color: #3b82f6 !important; }
body.single-post .postbox-details-nevigation-thumb-bg { background: #f1f4fb !important; }
body.single-post .postbox-details-nevigation-title { color: #1f2330 !important; }
body.single-post .postbox-details-code { background: #f6f6f9 !important; color: #1f2330 !important; }
body.single-post .postbox-details-code * { color: #1f2330 !important; }
body.single-post .postbox-details-form-title { color: #1f2330 !important; }
body.single-post .postbox-details-quote p { color: #1f2330 !important; }
</style>
<script>
document.addEventListener('DOMContentLoaded', function () {
  var MAP = {
    'Leave a Reply': 'Lascia un commento', 'Cancel reply': 'Annulla risposta', 'Comment': 'Commento',
    'Name': 'Nome', 'Name *': 'Nome *', 'Email': 'Email', 'Email *': 'Email *', 'Website': 'Sito web',
    'Save my name, email, and website in this browser for the next time I comment.': 'Salva il mio nome, email e sito web in questo browser per il prossimo commento.',
    'Post Comment': 'Invia commento', 'Submit Comment': 'Invia commento', 'Submit': 'Invia'
  };
  function translateComments() {
    var box = document.querySelector('.comment-respond, #commentform, .comment-form');
    if (!box) return;
    var root = box.closest('.comment-respond') || box;
    root.querySelectorAll('label').forEach(function (label) {
      var clone = label.cloneNode(true);
      clone.querySelectorAll('.required, span').forEach(function (s) { s.remove(); });
      var text = clone.textContent.trim();
      if (MAP[text]) {
        var req = label.querySelector('.required');
        label.textContent = MAP[text] + (req ? ' ' : '');
        if (req) label.appendChild(req);
      }
    });
    var title = root.querySelector('#reply-title');
    if (title) {
      var small = title.querySelector('small');
      var smallHtml = small ? small.outerHTML : '';
      var titleText = title.childNodes[0] ? title.childNodes[0].textContent.trim() : '';
      if (MAP[titleText]) title.innerHTML = MAP[titleText] + ' ' + smallHtml;
    }
    var cancelLink = root.querySelector('#cancel-comment-reply-link');
    if (cancelLink && MAP[cancelLink.textContent.trim()]) cancelLink.textContent = MAP[cancelLink.textContent.trim()];
    root.querySelectorAll('input[type="submit"], button[type="submit"]').forEach(function (btn) {
      var v = btn.value || btn.textContent.trim();
      if (MAP[v]) { if (btn.value) btn.value = MAP[v]; else btn.textContent = MAP[v]; }
    });
  }
  translateComments();
  var tries = 0;
  var interval = setInterval(function () { translateComments(); tries++; if (tries > 10) clearInterval(interval); }, 600);
});
</script>`

async function publishArticle(article) {
  const categoryId = CATEGORY_IDS[article.category] || CATEGORY_IDS.tools
  const tagIds = []
  for (const tagName of (article.tags || []).slice(0, 5)) {
    const id = await getOrCreateTagId(tagName)
    if (id) tagIds.push(id)
  }

  const emoji = article.cover_emoji || '🚀'
  const slug = `${slugify(article.title)}-${Date.now().toString(36).slice(-4)}`

  const res = await fetch(`${WP_BASE}/posts`, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${emoji} ${article.title}`,
      slug,
      excerpt: article.summary || '',
      content: FIX_BLOCK + '\n' + (article.content || ''),
      categories: [CATEGORY_IDS.news_ai, categoryId],
      tags: tagIds,
      status: 'publish'
    })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Errore pubblicazione "${article.title}": ${JSON.stringify(data).slice(0, 300)}`)
  return data
}

async function main() {
  console.log('Recupero titoli recenti per evitare duplicati...')
  const existingTitles = await getRecentTitles()
  console.log(`Trovati ${existingTitles.length} articoli recenti.`)

  const slots = buildSlots()
  let successCount = 0

  for (const slot of slots) {
    console.log(`\nGenero articolo "${slot.category}"...`)
    try {
      const article = await generateOneArticle(slot, existingTitles)
      const published = await publishArticle(article)
      console.log(`OK -> [${article.category}] ${article.title} (id ${published.id}, link ${published.link})`)
      successCount++
    } catch (err) {
      console.error(`ERRORE su slot "${slot.category}":`, err.message)
    }
  }

  console.log(`\nCompletato: ${successCount}/${slots.length} articoli pubblicati.`)
  if (successCount === 0) process.exit(1)
}

main().catch(err => {
  console.error('Errore fatale:', err)
  process.exit(1)
})

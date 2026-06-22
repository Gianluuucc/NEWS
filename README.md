# NEWS — Pubblicazione automatica giornaliera per gigawebagency.it

Questo repository genera ogni giorno, tramite GitHub Actions, 4 articoli per il blog di [gigawebagency.it](https://gigawebagency.it/news/):

1. Una notizia sull'intelligenza artificiale
2. Una notizia/tendenza sul mondo dei siti web
3. Un consiglio pratico del giorno per chi gestisce un sito
4. Una guida a uno strumento utile per gestire un sito

Gli articoli vengono scritti in italiano da Gemini (con ricerca Google integrata per informazioni aggiornate) e pubblicati direttamente su WordPress tramite REST API.

## Configurazione richiesta

In **Settings → Secrets and variables → Actions** di questo repository, devono essere presenti questi 3 secret:

- `GEMINI_API_KEY` — chiave API di Google AI Studio
- `WP_USER` — utente WordPress (email)
- `WP_APP_PASSWORD` — application password generata da WordPress (Profilo → Application Passwords)

## Esecuzione

- **Automatica**: ogni giorno alle 06:17 UTC (`.github/workflows/daily-news.yml`)
- **Manuale**: dalla tab "Actions" di GitHub, workflow "Pubblica news quotidiane GiGaWeb" → "Run workflow"

## File principali

- `generate-news.js` — script Node.js che genera gli articoli e li pubblica
- `.github/workflows/daily-news.yml` — schedulazione GitHub Actions

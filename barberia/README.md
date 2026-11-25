# Barberia · Gestione prenotazioni

Applicazione web (cliente + gestore) per prenotare i tagli in una barberia con 2 postazioni.
Nessuna dipendenza esterna: Node.js ≥ 22.13 con SQLite integrato.

## Avvio

```bash
cd barberia
npm start            # http://localhost:3000
npm test             # test automatici delle regole
```

Variabili opzionali: `PORT` (default 3000), `DB_FILE` (default `barberia.db`),
`ADMIN_PASSWORD` (password iniziale del gestore, default `admin123`),
`BARBER_TZ` (fuso orario, default `Europe/Rome`).

**Accesso gestore:** telefono `admin`, password `admin123` → cambiala subito da *Impostazioni*.

## Regole implementate

| Regola | Come funziona |
|---|---|
| Orario prenotato = bloccato | Ogni blocco (postazione + giorno + ora) può avere una sola prenotazione attiva; garantito anche da un indice univoco nel database. |
| Niente disdetta a meno di 3 ore | Il cliente non può disdire se mancano meno di 3 ore (configurabile). Il gestore può sempre annullare e il cliente riceve una notifica. |
| Coda | Il cliente si mette in coda per un giorno (barbiere e fascia oraria opzionali). Quando un posto compatibile si libera viene **riservato** al primo in coda per 30 minuti (configurabile): può accettarlo o rifiutarlo; se rifiuta o non risponde passa al successivo. |
| Orari | Martedì–sabato, 8:00–13:00 e 15:00–20:00, un taglio ogni 30 minuti. |
| 2 postazioni | Il cliente sceglie con chi tagliarsi i capelli. I nomi sono modificabili dal gestore. |
| Il gestore cambia gli orari | Fasce orarie per ogni giorno, durata del taglio, chiusure straordinarie (ferie/festivi). |
| Taglio settimanale automatico | Il cliente sceglie giorno, ora e barbiere (o indifferente): il sistema prenota da solo le prossime 4 settimane (configurabile) e aggiorna ogni ora. Se l'orario è occupato prova l'altra postazione (se il cliente lo consente), altrimenti lo avvisa. |

## Funzioni del gestore

- Agenda giornaliera delle 2 postazioni con nome e telefono dei clienti
- Inserimento di appuntamenti per clienti al banco o al telefono
- Annullamento di qualsiasi appuntamento
- Coda del giorno, elenco clienti e tagli settimanali attivi
- Orari di lavoro, chiusure, nomi dei barbieri, limiti (disdetta, riserva coda, giorni prenotabili)

## Struttura

```
server.js          server HTTP + API REST
src/logic.js       regole di business (prenotazioni, coda, settimanale)
src/db.js          schema SQLite e valori iniziali
src/auth.js        hash password e token di sessione
public/            interfaccia web (HTML/CSS/JS, responsive per smartphone)
test/              test delle regole (node --test)
```

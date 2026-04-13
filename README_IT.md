# OPENSTOKO Guida Utente (Italiano)

> Documentation Release: **2026-03-15** (Release Docs baseline).

OPENSTOKO e un sistema per magazzino e vendite con accesso per ruoli, basato su FastAPI + Next.js + MySQL 8.4.

## 1. Accesso
- App: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`
- phpMyAdmin (opzionale): `http://localhost:8081`

Utenti predefiniti:
- `admin` / `admin123`
- `operator1` viene creato da admin se necessario

## 2. Ruoli
- `operator`: carico/scarico giornaliero e checkout.
- `admin`: gestione prodotti, prezzi, soglie, utenti, report e storni.

## 3. Lingue
- Inglese (`en`)
- Bulgaro (`bg`)
- Italiano (`it`)

## 4. Flusso operatore
1. Apri `Operatore`.
2. Scegli modalita: `Carico` o `Scarico`.
3. Priorita ricerca in scarico:
- barcode fabbrica
- codice interno (SKU)
- nome
- categoria
4. Aggiungi articoli alla bozza vendita.
5. Verifica subtotali e totale.
6. Conferma checkout.
7. Stampa etichette garanzia per i SN venduti.

## 5. Flusso admin
In `Configurazione prodotti` admin puo modificare i parametri del prodotto.
I numeri seriali (SN) sono univoci per unita fisica e non vengono modificati nella scheda prodotto.

## 6. Inventory Health
- `Critico`: stock <= soglia
- `Avviso`: stock <= soglia * 1.2
- `Buono`: sopra soglia avviso

## 7. Approvazioni storno
- Operatore crea richiesta storno.
- Admin approva/rifiuta.
- Se approvato, il seriale torna in stock e resta nello storico.

## 8. Audit e sicurezza
- Azioni importanti salvate in `audit_logs`.
- Modifiche admin con valori old/new.
- Nessun endpoint per eliminare audit.
- Trigger DB (se permessi disponibili) bloccano update/delete su `audit_logs`.

## 9. Supporto e consulenza
Per supporto tecnico su installazione e configurazione server:
- Email: `p.m.malinov@gmail.com`

Contatto professionale:
- LinkedIn: `www.linkedin.com/in/plamen-malinov-883139105`

## 10. Custom Development
Sono disponibili personalizzazioni su richiesta:
- workflow dedicati per settore
- integrazioni con sistemi esterni
- reportistica personalizzata
- automazioni operative

## 11. Documenti collegati
- README principale: `README.md`
- Guide clienti: `README_EN.md`, `README_BG.md`, `README_IT.md`
- Documenti tecnici (admin/dev): `docs/technical/`

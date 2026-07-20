# StampDAG

*(vormals "KaspaNotar" — Projektordner/Interna behalten aus historischen Gründen
weiterhin diesen Namen, das sichtbare Produkt heißt StampDAG.)*

Digitaler Dokumenten-Zeitstempel auf Basis der Kaspa BlockDAG, gemäß
`KaspaNotar_Lasten_Pflichtenheft.docx`.

Nutzer laden ein Dokument (PDF, Bild oder Word) hoch, der SHA-256-Hash wird
**client-seitig** berechnet und als Payload in eine Kaspa-Transaktion verankert.
Bezahlt wird entweder:
- **ohne Login**: über eine einzelne, Plattform-eigene Anker-Wallet, oder
- **mit Wallet-Login** (Kasware): der Nutzer signiert selbst und zahlt die
  (minimale) Netzwerkgebühr aus der eigenen Wallet (§3.9 Stufe 1 "Sign-in with
  Wallet", ausschließlich zur Zahlungsautorisierung — keine Profile/kein Dashboard).

Identitätsprüfung (eID/Video-Ident, §2.6 Stufe 2 / F-16) ist weiterhin bewusst nicht
umgesetzt.

## Architektur

- `backend/` — Node.js/Express-API, SQLite (Postgres optional), Kaspa-Anbindung
- `frontend/` — Vanilla JS/CSS, kein Build-Schritt, PWA:
  - `index.html` — Verankern/Verifizieren/Verlauf
  - `about.html` — Info-Seite (Funktionsweise + Anwendungsfälle)
  - `shared.css` — gemeinsames Stylesheet beider Seiten
  - `i18n.js` — Deutsch/Englisch-Umschaltung
  - `wallet.js` — Kasware-Anbindung (Login + Eigenzahlung)

## Payload-Format

Jede Verankerung trägt 36 Bytes: 4-Byte ASCII-Magic `"KN01"` gefolgt vom rohen
32-Byte SHA-256-Digest, hex-kodiert. Damit kann jede dritte Partei eine Verankerung
direkt aus den Chain-Daten auslesen, ohne dem Backend zu vertrauen.

## Setup

```bash
cd backend
npm install
cp .env.example .env
# .env bearbeiten: mind. ANCHOR_WALLET_ENCRYPTION_KEY und JWT_SECRET setzen

npm run wallet:generate    # erzeugt anchor-wallet.keystore.json, druckt die Adresse
# → Adresse mit Testnet-10-Faucet (https://faucet-tn10.kaspanet.io/) fluten,
#   bzw. bei NETWORK=mainnet mit echtem KAS befüllen

npm start                  # http://localhost:3210
```

Alternativ: `backend/run_kaspanotar.command` doppelklicken (macOS) — richtet `.env`,
Anker-Wallet und Abhängigkeiten beim ersten Start automatisch ein.

## Wichtige Env-Variablen (siehe `.env.example`)

- `NETWORK` — `testnet-10` (Standard, für Entwicklung) oder `mainnet`
- `ANCHOR_WALLET_ENCRYPTION_KEY` — Passphrase zur AES-256-GCM-Verschlüsselung des
  Anker-Wallet-Mnemonics; wird nie auf Platte geschrieben
- `JWT_SECRET` — Signierschlüssel für Wallet-Login-Sessions (erforderlich, kein
  Default — Server startet ohne diesen Wert nicht)
- `DB_DRIVER` — `sqlite` (Standard) oder `postgres` (zusätzlich `DATABASE_URL` setzen)
- `RATE_LIMIT_ANCHOR_MAX` — Limit für `/api/anchor` (Plattform-Wallet zahlt) pro
  IP/15min (Standard: 5) — bewusst knapp, da der Betreiber jede Verankerung bezahlt
- `RATE_LIMIT_SELF_ANCHOR_MAX` — Limit für `/api/anchor/self` (Nutzer-Wallet zahlt)
  pro IP/15min (Standard: 60) — großzügiger, da diese Verankerungen den Betreiber
  nichts kosten
- `RATE_LIMIT_AUTH_MAX` — Limit für `/api/auth/*` pro IP/15min (Standard: 20)

## Umstieg auf Mainnet

1. `NETWORK=mainnet` in `.env` setzen
2. `npm run wallet:generate -- --network mainnet` (neue Keystore-Datei, da Adressen
   pro Netzwerk unterschiedlich sind — alte Testnet-Keystore vorher sichern/umbenennen)
3. Die ausgegebene `kaspa:...`-Adresse mit echtem KAS befüllen
4. Health-Check (`GET /api/health`) prüfen, dann eine Testverankerung durchführen und
   auf https://explorer.kaspa.org verifizieren, bevor produktiv genutzt wird

## Endpunkte

| Endpunkt | Zweck |
|---|---|
| `POST /api/anchor` | Hash verankern, bezahlt von der Plattform-Wallet (dedupliziert) |
| `POST /api/auth/challenge` | Login-Challenge für eine Kaspa-Adresse anfordern |
| `POST /api/auth/verify` | Signierte Challenge einlösen → JWT (24h gültig) |
| `POST /api/anchor/self` | Bereits selbst gesendete Verankerung registrieren (Auth erforderlich; prüft On-Chain-Payload gegen den Hash, bevor etwas gespeichert wird) |
| `GET /api/anchor/:txid` | Bestätigungsstatus abfragen |
| `POST /api/verify` | Verankerung per Hash oder TXID prüfen |
| `GET /api/certificate/:id` | PDF-Zertifikat mit QR-Code herunterladen (`?lang=de\|en`) |
| `GET /api/health` | DB- und Wallet-Status |

## Wallet-Login (Kasware)

Nutzer mit der [Kasware-Browsererweiterung](https://www.kasware.xyz/) können sich
anmelden und Verankerungen direkt aus der eigenen Wallet bezahlen:

1. `requestAccounts()` → Adresse
2. `POST /api/auth/challenge` → Nachricht zum Signieren
3. `kasware.signMessage(...)` → Signatur
4. `POST /api/auth/verify` → JWT
5. `kasware.sendKaspa(eigeneAdresse, kleinerBetrag, { payload })` → TXID
6. `POST /api/anchor/self` (mit Bearer-Token) → Backend verifiziert den On-Chain-Payload
   unabhängig, bevor es die Verankerung speichert

Ohne Login läuft alles unverändert über die Plattform-Wallet.

## Tests

```bash
cd backend
npm test              # vitest: 31 Tests, ~1s, kein Netzwerk/echtes Geld nötig
npm run test:watch    # bei Codeänderungen automatisch neu laufen lassen
```

Läuft komplett gegen eine eigene, nie befüllte Testnet-Wallet (`tests/fixtures/`,
niemals gegen die echte `.env`) und mockt jede Funktion, die die Blockchain
anfassen würde — kann also gefahrlos beliebig oft laufen. Abgedeckt: Payload-Format,
Signaturprüfung (echte, gültige und gefälschte Signaturen), Validierung, Dedup-Logik,
Wallet-Login-Flow (inkl. Single-Use-Challenge), On-Chain-Payload-Abgleich bei
`/api/anchor/self` (inkl. Ablehnung bei Nichtübereinstimmung und Adress-Konflikt),
sowie dass 500er-Fehler keine internen Details preisgeben.

`npm run e2e` (Playwright) ist als Skript vorbereitet, aber es existiert noch keine
Konfiguration/Testdatei dafür — die App wurde bisher stattdessen manuell und per
Skript gegen echtes Testnet/Mainnet durchgetestet.

## Out of Scope (bewusst, siehe Pflichtenheft-Roadmap)

Nutzerkonten/Verlauf-Dashboard (F-08), Batch/Merkle-Verankerung (F-11), öffentliche
API (F-12), Identitätsprüfung/„Verified"-Tier (F-16, Kap. 2.6/3.9 Stufe 2).

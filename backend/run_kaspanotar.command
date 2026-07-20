#!/bin/bash
cd "$(dirname "$0")"

echo "========================================================"
echo "  StampDAG Backend Server"
echo "  App: http://localhost:3210"
echo "========================================================"
echo ""

if ! command -v node &>/dev/null; then
    echo "❌  Node.js nicht gefunden."
    echo "   Bitte installiere Node.js von https://nodejs.org"
    read -p "Enter zum Beenden..."; exit 1
fi

echo "✅  Node.js: $(node --version)"
echo ""

# Schon laufenden Server stoppen (Port freigeben)
PORT="${PORT:-3210}"
if lsof -ti tcp:$PORT >/dev/null 2>&1; then
    echo "⚠️  Port $PORT belegt — stoppe alten Server..."
    lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null
    sleep 1
fi

# Dependencies installieren wenn nötig
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@kluster" ]; then
    echo "📦  Installiere Pakete (einmalig)..."
    npm install --quiet
fi

# .env anlegen falls nicht vorhanden
if [ ! -f ".env" ]; then
    echo "🔐  Keine .env gefunden — erstelle aus .env.example"
    cp .env.example .env
    NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    NEW_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    node -e "
      const fs = require('fs');
      let c = fs.readFileSync('.env', 'utf8');
      c = c.replace(/ANCHOR_WALLET_ENCRYPTION_KEY=.*/, 'ANCHOR_WALLET_ENCRYPTION_KEY=$NEW_KEY');
      c = c.replace(/JWT_SECRET=.*/, 'JWT_SECRET=$NEW_JWT_SECRET');
      fs.writeFileSync('.env', c);
    "
    chmod 600 .env
    echo "✅  .env erstellt mit neuer ANCHOR_WALLET_ENCRYPTION_KEY und JWT_SECRET (bitte NICHT in git committen)"
fi

chmod 600 .env
set -a
source .env
set +a

# Anker-Wallet anlegen falls noch keine existiert
if [ ! -f "anchor-wallet.keystore.json" ]; then
    echo ""
    echo "🪪  Keine Anker-Wallet gefunden — erzeuge eine neue für Netzwerk: ${NETWORK:-testnet-10}"
    node scripts/generate-anchor-wallet.js
    echo ""
    echo "⚠️  WICHTIG: Die oben ausgegebene Adresse muss erst befüllt werden,"
    echo "    bevor Verankerungen funktionieren (Testnet-10: https://faucet-tn10.kaspanet.io/)."
    echo ""
fi

chmod 600 anchor-wallet*.keystore.json 2>/dev/null
chmod 600 *.db *.db-shm *.db-wal 2>/dev/null

echo "🚀  Starte StampDAG Server..."
echo "    Stoppen: Ctrl+C in diesem Fenster"
echo ""
node server.js

echo ""
read -p "Enter zum Beenden..."

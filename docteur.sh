#!/bin/sh
# Bilan de sante de Photon, sous Linux ou macOS.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Les dependances ne sont pas installees. Lancez ./start.sh, ou tapez : npm install"
  exit 1
fi

exec npm run --silent docteur

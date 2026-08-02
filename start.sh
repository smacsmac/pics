#!/bin/sh
# Lance Photon sous Linux ou macOS.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez."
  exit 1
fi

[ -d node_modules ] || { echo "Première installation…"; npm install; }
[ -f web/dist/index.html ] || { echo "Construction de l'interface…"; npm run build; }

exec npm start

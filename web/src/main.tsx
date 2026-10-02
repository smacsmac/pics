import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ShareApp } from './ShareApp';
import { StoreProvider } from './lib/store';
import { tokenFromPath } from './lib/share-api';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable');

/**
 * Deux applications dans un seul fichier construit.
 *
 * Sur `/p/<jeton>`, on monte la vue d'invité seule — sans `StoreProvider`, qui
 * commencerait par appeler `/api/state`. Cette route est refusée aux visiteurs
 * distants, et l'appel échouerait : l'invité verrait une page en erreur avant
 * d'avoir vu une seule photo.
 */
const token = tokenFromPath();

createRoot(root).render(
  <StrictMode>
    {token !== null ? (
      <ShareApp token={token} />
    ) : (
      <StoreProvider>
        <App />
      </StoreProvider>
    )}
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initServerTime } from './state/serverTime';
import './styles.css';

// every game keeps its own stylesheet next to its View
import.meta.glob('./games/*/styles.css', { eager: true });

initServerTime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

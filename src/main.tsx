import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initServerTime } from './state/serverTime';
import './styles.css';

initServerTime();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

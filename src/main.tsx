import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './effects/autoSaveDzn';
import './effects/language';
import './effects/printSessionResume';
import './effects/profileSpoolSync';
import { registerServiceWorker } from './pwa/registerServiceWorker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();

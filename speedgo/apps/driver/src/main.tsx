import '@speedgo/ui/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@speedgo/ui';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);

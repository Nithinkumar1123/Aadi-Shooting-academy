import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import InstallPrompt from './components/InstallPrompt.jsx';
import { registerPwa } from './lib/pwa';
import './styles.css';
import './public-home.css';
import './auth.css';
import './portal-theme.css';
import './brand-refresh.css';

registerPwa();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><App /><InstallPrompt /></BrowserRouter></React.StrictMode>
);

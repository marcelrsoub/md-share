import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import { AdminApp } from './App.js';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);

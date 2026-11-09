import React from 'react';
import { createRoot } from 'react-dom/client';
import JournalApp from './journal-app';
import './style.css';
createRoot(document.getElementById('root')!).render(<JournalApp/>);
if('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load',()=>{navigator.serviceWorker.register('/master/this-year/service-worker.js').catch(()=>{});});

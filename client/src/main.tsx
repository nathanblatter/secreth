import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './screens/App';
import BugReport from './components/BugReport';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <App />
    <BugReport />
  </React.StrictMode>,
);

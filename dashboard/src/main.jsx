import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Prevent "Cannot read properties of undefined (reading 'enumerateDevices')" on HTTP (insecure context)
if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
  navigator.mediaDevices = {
    enumerateDevices: () => Promise.resolve([]),
    getUserMedia: () => Promise.reject(new DOMException('HTTPS or localhost required', 'NotSupportedError')),
    getSupportedConstraints: () => ({}),
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter
      basename="/room"
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

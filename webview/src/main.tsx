import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { AugmentosAuthProvider } from '@augmentos/react'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AugmentosAuthProvider>
      <App />
    </AugmentosAuthProvider>
  </React.StrictMode>,
) 
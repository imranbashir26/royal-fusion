import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { createBlogIntegration } from './services/blogIntegrationConfig'

const blogIntegration = createBlogIntegration(import.meta.env)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App blogIntegration={blogIntegration} />
    </BrowserRouter>
  </StrictMode>,
)

import { AnimatePresence } from 'framer-motion'
import { useCallback, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { PageTransition } from './components/animations/PageTransition'
import { Preloader } from './components/animations/Preloader'
import { Layout } from './components/layout/Layout'
import { AboutPage } from './pages/AboutPage'
import { AttarsPage } from './pages/AttarsPage'
import { BlogDetailsPage } from './pages/BlogDetailsPage'
import { BlogsPage } from './pages/BlogsPage'
import { CartPage } from './pages/CartPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { CollectionsPage } from './pages/CollectionsPage'
import { ContactPage } from './pages/ContactPage'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProductDetailsPage } from './pages/ProductDetailsPage'
import { ShopPage } from './pages/ShopPage'
import { WishlistPage } from './pages/WishlistPage'

function App() {
  const [isIntroVisible, setIsIntroVisible] = useState(() => {
    return !window.sessionStorage.getItem('royal-fusion-intro-played')
  })

  const handleIntroComplete = useCallback(() => {
    window.sessionStorage.setItem('royal-fusion-intro-played', 'true')
    setIsIntroVisible(false)
  }, [])

  return (
    <Layout>
      <AnimatedRoutes />
      <AnimatePresence>
        {isIntroVisible && <Preloader onComplete={handleIntroComplete} />}
      </AnimatePresence>
    </Layout>
  )
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route
          path="/"
          element={
            <PageTransition>
              <HomePage />
            </PageTransition>
          }
        />
        <Route
          path="/shop"
          element={
            <PageTransition>
              <ShopPage />
            </PageTransition>
          }
        />
        <Route
          path="/product/:slug"
          element={
            <PageTransition>
              <ProductDetailsPage />
            </PageTransition>
          }
        />
        <Route
          path="/collections"
          element={
            <PageTransition>
              <CollectionsPage />
            </PageTransition>
          }
        />
        <Route
          path="/attars"
          element={
            <PageTransition>
              <AttarsPage />
            </PageTransition>
          }
        />
        <Route
          path="/blogs"
          element={
            <PageTransition>
              <BlogsPage />
            </PageTransition>
          }
        />
        <Route
          path="/blogs/:slug"
          element={
            <PageTransition>
              <BlogDetailsPage />
            </PageTransition>
          }
        />
        <Route
          path="/about"
          element={
            <PageTransition>
              <AboutPage />
            </PageTransition>
          }
        />
        <Route
          path="/contact"
          element={
            <PageTransition>
              <ContactPage />
            </PageTransition>
          }
        />
        <Route
          path="/cart"
          element={
            <PageTransition>
              <CartPage />
            </PageTransition>
          }
        />
        <Route
          path="/checkout"
          element={
            <PageTransition>
              <CheckoutPage />
            </PageTransition>
          }
        />
        <Route
          path="/wishlist"
          element={
            <PageTransition>
              <WishlistPage />
            </PageTransition>
          }
        />
        <Route
          path="*"
          element={
            <PageTransition>
              <NotFoundPage />
            </PageTransition>
          }
        />
      </Routes>
    </AnimatePresence>
  )
}

export default App

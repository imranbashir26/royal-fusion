import { AnimatePresence } from 'framer-motion'
import type { ElementType, ReactNode } from 'react'
import { lazy, Suspense, useCallback, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AdminAuthProvider, useAdminAuth } from './admin/AdminAuthProvider'
import { PageTransition } from './components/animations/PageTransition'
import { Preloader } from './components/animations/Preloader'
import { Layout } from './components/layout/Layout'
import { SeoManager } from './components/layout/SeoManager'
import { StorefrontProvider } from './storefront/StorefrontProvider'

const AdminLoginPage = lazy(() => import('./admin/AdminLoginPage').then((module) => ({ default: module.AdminLoginPage })))
const AdminRoutes = lazy(() => import('./admin/AdminRoutes').then((module) => ({ default: module.AdminRoutes })))
const AboutPage = lazy(() => import('./pages/AboutPage').then((module) => ({ default: module.AboutPage })))
const AttarsPage = lazy(() => import('./pages/AttarsPage').then((module) => ({ default: module.AttarsPage })))
const BlogDetailsPage = lazy(() => import('./pages/BlogDetailsPage').then((module) => ({ default: module.BlogDetailsPage })))
const BlogsPage = lazy(() => import('./pages/BlogsPage').then((module) => ({ default: module.BlogsPage })))
const CartPage = lazy(() => import('./pages/CartPage').then((module) => ({ default: module.CartPage })))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((module) => ({ default: module.CheckoutPage })))
const CollectionsPage = lazy(() => import('./pages/CollectionsPage').then((module) => ({ default: module.CollectionsPage })))
const ContactPage = lazy(() => import('./pages/ContactPage').then((module) => ({ default: module.ContactPage })))
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))
const ProductDetailsPage = lazy(() => import('./pages/ProductDetailsPage').then((module) => ({ default: module.ProductDetailsPage })))
const ShopPage = lazy(() => import('./pages/ShopPage').then((module) => ({ default: module.ShopPage })))
const WishlistPage = lazy(() => import('./pages/WishlistPage').then((module) => ({ default: module.WishlistPage })))

function App() {
  return (
    <StorefrontProvider>
      <AdminAuthProvider>
        <Routes>
          <Route
            path="/admin/login"
            element={
              <Suspense fallback={<FullscreenLoader label="Loading admin login..." />}>
                <AdminLoginPage />
              </Suspense>
            }
          />
          <Route
            path="/admin/*"
            element={
              <ProtectedAdminRoute>
                <Suspense fallback={<FullscreenLoader label="Loading admin dashboard..." />}>
                  <AdminRoutes />
                </Suspense>
              </ProtectedAdminRoute>
            }
          />
          <Route path="/*" element={<PublicApp />} />
        </Routes>
      </AdminAuthProvider>
    </StorefrontProvider>
  )
}

function PublicApp() {
  const [isIntroVisible, setIsIntroVisible] = useState(() => {
    return !window.sessionStorage.getItem('royal-fusion-intro-played')
  })

  const handleIntroComplete = useCallback(() => {
    window.sessionStorage.setItem('royal-fusion-intro-played', 'true')
    setIsIntroVisible(false)
  }, [])

  return (
    <Layout>
      <SeoManager />
      <AnimatedRoutes />
      <AnimatePresence>
        {isIntroVisible && <Preloader onComplete={handleIntroComplete} />}
      </AnimatePresence>
    </Layout>
  )
}

function ProtectedAdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAdminAuth()

  if (isLoading) {
    return <FullscreenLoader label="Loading admin session..." />
  }

  if (!isAuthenticated) return <Navigate replace to="/admin/login" />
  return children
}

function FullscreenLoader({ label }: { label: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-marble text-burgundy">
      <span className="font-semibold">{label}</span>
    </div>
  )
}

function publicPage(Page: ElementType) {
  return (
    <Suspense fallback={null}>
      <PageTransition>
        <Page />
      </PageTransition>
    </Suspense>
  )
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={publicPage(HomePage)} />
        <Route path="/shop" element={publicPage(ShopPage)} />
        <Route path="/product/:slug" element={publicPage(ProductDetailsPage)} />
        <Route path="/collections" element={publicPage(CollectionsPage)} />
        <Route path="/attars" element={publicPage(AttarsPage)} />
        <Route path="/blogs" element={publicPage(BlogsPage)} />
        <Route path="/blogs/:slug" element={publicPage(BlogDetailsPage)} />
        <Route path="/about" element={publicPage(AboutPage)} />
        <Route path="/contact" element={publicPage(ContactPage)} />
        <Route path="/cart" element={publicPage(CartPage)} />
        <Route path="/checkout" element={publicPage(CheckoutPage)} />
        <Route path="/wishlist" element={publicPage(WishlistPage)} />
        <Route path="*" element={publicPage(NotFoundPage)} />
      </Routes>
    </AnimatePresence>
  )
}

export default App

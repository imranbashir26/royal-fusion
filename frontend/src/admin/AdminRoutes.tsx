import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminDashboardPage } from './AdminDashboardPage'
import { AdminFragranceFinderPage } from './AdminFragranceFinderPage'
import { AdminLayout } from './AdminLayout'
import { AdminOrdersPage } from './AdminOrdersPage'
import { AdminResourceManager } from './AdminResourcePage'
import { AdminReviewsPage } from './AdminReviewsPage'
import { AdminNewsletterPage } from './AdminNewsletterPage'
import { AdminSeoPage } from './AdminSeoPage'
import { AdminSettingsPage } from './AdminSettingsPage'
import { AdminUsersPage } from './AdminUsersPage'

export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate replace to="dashboard" />} />
        <Route path="dashboard" element={<AdminDashboardPage />} />
        <Route path="products" element={<AdminResourceManager resource="products" />} />
        <Route path="categories" element={<AdminResourceManager resource="categories" />} />
        <Route path="fragrance-finder" element={<AdminFragranceFinderPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
        <Route path="customers" element={<AdminResourceManager resource="customers" />} />
        <Route path="coupons" element={<AdminResourceManager resource="coupons" />} />
        <Route path="banners" element={<AdminResourceManager resource="banners" />} />
        <Route path="blogs" element={<AdminResourceManager resource="blogs" />} />
        <Route path="testimonials" element={<AdminResourceManager resource="testimonials" />} />
        <Route path="reviews" element={<AdminReviewsPage />} />
        <Route path="newsletter" element={<AdminNewsletterPage />} />
        <Route path="contact-messages" element={<AdminResourceManager resource="contact-messages" />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="seo" element={<AdminSeoPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="*" element={<Navigate replace to="dashboard" />} />
      </Route>
    </Routes>
  )
}

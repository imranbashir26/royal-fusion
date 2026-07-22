# Royal Fusion Admin Management Documentation

## Developer Documentation

### What Was Added

- `backend/server/`: Express API with JWT admin auth, bcrypt password hashing, role permissions, media uploads, JSON persistence, public storefront APIs, checkout order APIs, coupon validation, and admin CRUD APIs.
- `backend/server/data/db.json`: Local JSON database seed for products, categories, orders, customers, coupons, banners, blogs, testimonials, reviews, newsletter, contact messages, settings, homepage content, shipping, payments, SEO, and editable pages.
- `frontend/src/admin/`: Protected React admin dashboard, login, layout, dashboard overview, resource managers, order management, settings, SEO/page editor, users/roles, and media upload UI.
- `frontend/src/storefront/StorefrontProvider.tsx`: Public storefront data provider that loads backend-managed content and falls back to local data if the API is not running.
- `frontend/src/services/adminApi.ts`: Authenticated admin API client.
- Updated checkout/contact/newsletter services to use backend APIs.

### Data Collections

- `users`
- `products`
- `categories`
- `orders`
- `customers`
- `coupons`
- `banners`
- `blogs`
- `testimonials`
- `reviews`
- `newsletterSubscribers`
- `contactMessages`
- `settings`
- `homepage`
- `shipping`
- `payments`
- `seo`
- `editablePages`

### API Routes

- Public:
  - `GET /api/health`
  - `GET /api/public/storefront`
  - `GET /api/public/products`
  - `GET /api/public/products/:slug`
  - `GET /api/public/blogs`
  - `GET /api/public/blogs/:slug`
  - `POST /api/public/newsletter`
  - `POST /api/public/contact`
  - `POST /api/public/coupons/validate`
  - `POST /api/public/orders`

- Admin Auth:
  - `POST /api/admin/auth/login`
  - `GET /api/admin/auth/me`
  - `POST /api/admin/auth/logout`
  - `GET /api/admin/auth/users`
  - `POST /api/admin/auth/users`
  - `PUT /api/admin/auth/users/:id`
  - `DELETE /api/admin/auth/users/:id`

- Admin:
  - `GET /api/admin/dashboard`
  - `GET /api/admin/resources/:resource`
  - `GET /api/admin/resources/:resource/export`
  - `POST /api/admin/resources/:resource`
  - `PUT /api/admin/resources/:resource/:id`
  - `PUT /api/admin/resources/:resource`
  - `DELETE /api/admin/resources/:resource/:id`
  - `POST /api/admin/orders/:id/status`
  - `POST /api/admin/orders/:id/notes`
  - `POST /api/admin/orders/:id/tracking`
  - `POST /api/admin/media`

### Authentication Flow

1. Admin logs in at `/admin/login`.
2. Backend verifies bcrypt password hash.
3. Backend returns a JWT with admin id, email, role, and name.
4. Frontend stores the token in local storage.
5. Admin API calls send `Authorization: Bearer <token>`.
6. Backend checks the token and role permission for every protected action.

### Roles

- Owner/Admin: full access
- Shop Manager: products, categories, stock, orders, coupons, shipping
- Order Manager: orders and customers
- Content Editor: blogs, banners, testimonials, homepage content, SEO, editable pages
- Blog Writer: blog drafts only

### Environment Variables

Copy `.env.example` to `.env`:

```bash
PORT=4177
CLIENT_ORIGIN=http://127.0.0.1:5173
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_SETUP_KEY=replace-with-a-private-setup-key
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_NAME=Royal Fusion Owner
```

### Create First Admin User

```bash
npm run admin:create -- --email owner@example.com --password "StrongPassword123!" --name "Owner Name"
```

No default password is committed to the repository.

### Run Locally

```bash
npm install
npm run dev:backend
npm run dev
```

Or run both together:

```bash
npm run dev:full
```

Frontend: `http://127.0.0.1:5173`  
API: `http://127.0.0.1:4177/api/health`

### Tests

```bash
npm run lint
npm run build
npm run api:smoke
```

### Deployment Notes

- Replace JSON persistence with MongoDB/Mongoose before production scale.
- Set a strong `JWT_SECRET`.
- Put uploads behind cloud storage.
- Serve the built Vite app from a static host or Express.
- Configure HTTPS and a production CORS origin.
- Add production-grade logging, backup, and monitoring.

## Client Documentation

### Login

1. Open `/admin/login`.
2. Enter the admin email and password provided by the developer.
3. Use the sidebar to manage the website.

### Add/Edit Products

1. Go to `/admin/products`.
2. Click `Add Product` or `Edit`.
3. Fill product name, SKU, price, sale price, stock, category, notes, occasion, toggles, and SEO fields.
4. Upload images in the product image section.
5. Click `Main` on an uploaded image to select the main product image.
6. Save.

### Manage Stock

1. Open `/admin/products`.
2. Edit a product.
3. Update `Stock quantity` and `Stock status`.
4. Save.

### Manage Orders

1. Go to `/admin/orders`.
2. Search by order, customer, phone, payment, or tracking.
3. Select an order to view details.
4. Change status, add courier/tracking, add internal notes, print invoice, or send WhatsApp confirmation.

### Create Coupons

1. Go to `/admin/coupons`.
2. Click `Add Coupon`.
3. Choose percentage, fixed amount, or free shipping.
4. Add dates, usage limits, minimum order amount, and status.
5. Save.

### Update Banners

1. Go to `/admin/banners`.
2. Add or edit title, subtitle, image, CTA text/link, position, and active dates.
3. Enable or disable the banner.

### Add Blogs

1. Go to `/admin/blogs`.
2. Add title, slug, excerpt, content paragraphs, tags, author, featured image, and SEO.
3. Save as draft or publish.

### Update Testimonials and Reviews

1. Go to `/admin/testimonials` or `/admin/reviews`.
2. Approve/reject reviews.
3. Mark selected reviews/testimonials as featured.
4. Delete spam entries.

### Update Shipping and Payment Settings

1. Go to `/admin/settings`.
2. Edit default shipping fee, free shipping amount, city/province shipping JSON, delivery text, and policies.
3. Edit payment method JSON to enable/disable COD, bank transfer, JazzCash, Easypaisa, or card placeholder.
4. Save.

### Update Contact and Social Links

1. Go to `/admin/settings`.
2. Edit WhatsApp, phone, email, address, Instagram, Facebook, TikTok, YouTube, footer text, and announcement bar.
3. Save.

### Newsletter Subscribers

1. Go to `/admin/newsletter`.
2. Search subscribers.
3. Delete subscribers if needed.
4. Use export to download a CSV.

### Contact Messages

1. Go to `/admin/contact-messages`.
2. View messages and mark read/unread.
3. Use reply email link.
4. Delete old/spam messages.

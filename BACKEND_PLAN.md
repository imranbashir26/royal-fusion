# Royal Fusion Backend Plan

This frontend currently uses local TypeScript data and a service layer that can be swapped for real API calls later.

## Proposed Stack

- Node.js + Express.js REST API
- MongoDB with Mongoose models
- JWT authentication for customers and admins
- Role-based admin dashboard access
- Cloud image storage for product/gallery assets
- Optional WooCommerce REST API integration for catalog/order sync

## Core Modules

- Auth: register, login, refresh token, profile, admin roles
- Products: CRUD, filters, search, inventory, image gallery, notes, sizes
- Categories and collections: CRUD and storefront ordering
- Orders: checkout, payment status, fulfillment status, customer history
- Reviews: product reviews, moderation, aggregate rating updates
- Blogs: SEO posts, slugs, categories, publishing status
- Contact: inquiry storage and response workflow
- Newsletter: subscriber capture, export, campaign integration

## API Migration Path

The current files in `src/services` should keep their public method names. Replace local imports with `apiClient.get('/products')`, `apiClient.post('/orders')`, and similar HTTP calls when the backend is ready.

## Suggested Database Models

- User
- Product
- Category
- Collection
- Order
- Review
- BlogPost
- ContactMessage
- NewsletterSubscriber

## Admin Dashboard

Admin should support product management, image uploads, category ordering, order status changes, review moderation, blog publishing, contact inbox, and newsletter export.

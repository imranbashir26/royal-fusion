# Media and Image Specification

## 1. Global Rules

- Commerce uploads use short-lived backend-authorized Cloudinary signatures. The client never receives API secrets.
- Raster upload formats: JPEG, PNG and WebP. AVIF is delivery-only until the upload pipeline validates it reliably. GIF and executable/vector uploads are rejected for user-managed commerce media.
- The trusted brand logo may be uploaded by developers as sanitized SVG or transparent PNG; dashboard users cannot upload arbitrary SVG.
- Orientation, dimensions, decoded MIME and byte size are verified after upload. EXIF metadata is stripped by transformation.
- Required alt text describes informative images in <= 160 characters. Decorative images use an explicit empty alt value.
- Focal points use normalized X/Y values from 0 to 1 and default to center.
- All delivery uses HTTPS Cloudinary URLs with automatic format/quality and width-based `srcset`.

## 2. Asset Matrix

| Asset type | Master px / ratio | Upload formats / max | Required | Delivery widths | Crop and display | Alt text |
|---|---|---|---|---|---|---|
| Primary logo | 1200x400 / 3:1 | Trusted SVG or PNG / 1 MB | Yes | 160, 240, 320, 480 | Contain, never crop | Brand name unless adjacent text duplicates it |
| Square logo/mark | 800x800 / 1:1 | Trusted SVG or PNG / 1 MB | Recommended | 32, 64, 128, 256 | Contain | Brand name or decorative empty alt |
| Product primary | 1600x2000 / 4:5 | JPEG, PNG, WebP / 5 MB | Yes | 320, 480, 640, 800, 1200, 1600 | Cover card; contain on zoom/detail where appropriate; focal point | Product and presentation |
| Product gallery | 1600x2000 / 4:5 | JPEG, PNG, WebP / 5 MB each | Recommended | 480, 800, 1200, 1600 | Cover thumbnails, contain full view | Specific view/detail |
| Variant image | 1600x2000 / 4:5 | JPEG, PNG, WebP / 5 MB | Optional | 320, 480, 800, 1200 | Same as product; fallback to product media | Product plus variant attributes |
| Product detail diagram | 1600x1200 / 4:3 | PNG, WebP, JPEG / 4 MB | Optional | 480, 800, 1200, 1600 | Contain; no text crop | Describe visible information |
| Hero desktop | 2400x1200 / 2:1 | JPEG, WebP, PNG / 8 MB | Yes per slide | 960, 1280, 1600, 1920, 2400 | Cover with desktop focal/safe zone | Meaningful campaign description |
| Hero mobile | 1080x1350 / 4:5 | JPEG, WebP, PNG / 5 MB | Yes per slide | 390, 540, 720, 1080 | Cover with mobile focal/safe zone | Match desktop campaign meaning |
| Promo banner desktop | 2000x800 / 5:2 | JPEG, WebP, PNG / 6 MB | Required when campaign used | 768, 1200, 1600, 2000 | Cover, separate focal point | Campaign purpose |
| Promo banner mobile | 1080x1350 / 4:5 | JPEG, WebP, PNG / 5 MB | Required when campaign used | 390, 540, 720, 1080 | Cover | Match campaign purpose |
| Category card | 1200x1500 / 4:5 | JPEG, WebP, PNG / 4 MB | Yes when published on cards | 240, 360, 480, 720, 1200 | Cover | Category name/context |
| Collection card | 1200x1500 / 4:5 | JPEG, WebP, PNG / 4 MB | Yes when featured | 240, 360, 480, 720, 1200 | Cover | Collection name/context |
| Collection banner desktop | 2000x800 / 5:2 | JPEG, WebP, PNG / 6 MB | Optional | 768, 1200, 1600, 2000 | Cover | Collection context |
| Collection banner mobile | 1080x1350 / 4:5 | JPEG, WebP, PNG / 5 MB | Optional with desktop banner | 390, 540, 720, 1080 | Cover | Collection context |
| Authentication desktop | 1800x2400 / 3:4 | JPEG, WebP / 6 MB | Yes | 720, 1080, 1440, 1800 | Cover; keep product/subject in safe area | Decorative empty alt when beside auth heading |
| Authentication mobile | 1080x1350 / 4:5 | JPEG, WebP / 4 MB | Optional | 390, 540, 720, 1080 | Cover | Decorative empty alt |
| Blog cover | 1600x900 / 16:9 | JPEG, WebP, PNG / 5 MB | Yes per published article | 480, 800, 1200, 1600 | Cover with focal point | Article-specific description |
| Blog inline | 1600x1200 / max 4:3 | JPEG, WebP, PNG / 5 MB | Optional | 480, 800, 1200, 1600 | Contain by default; editorial crop explicit | Required unless decorative |
| Testimonial portrait | 800x800 / 1:1 | JPEG, WebP, PNG / 3 MB | Optional | 96, 160, 240, 400, 800 | Cover face-aware focal point | Person name with consent, or decorative |
| Review image | 1200x1500 / 4:5 | JPEG, WebP, PNG / 4 MB each | Optional, max 5 | 240, 480, 720, 1200 | Cover thumbnail, contain lightbox | Customer-provided description or generated neutral alt |
| Open Graph default | 1200x630 / 1.91:1 | JPEG, PNG, WebP / 2 MB | Yes | 1200 | Cover; text inside safe margins | Not rendered as page content |
| Social share campaign | 1200x630 / 1.91:1 | JPEG, PNG, WebP / 3 MB | Optional | 1200 | Cover | Not rendered as page content |

## 3. Cloudinary Folder Policy

```text
royal-fusion/
  products/
  variants/
  categories/
  collections/
  homepage/
  campaigns/
  reviews/
  blogs/
```

- Backend maps asset type to a fixed folder; the client cannot submit an arbitrary folder.
- Blog images move to the Sanity asset pipeline when Sanity is integrated. Until then, `royal-fusion/blogs/` is allowed only through the controlled local-content publishing workflow.
- Public IDs use generated identifiers, never customer names, email, phone or original paths.

## 4. Signed Upload Workflow

1. Authorized admin requests a signature with asset type, expected byte size, dimensions and MIME.
2. Backend validates permission, allowed folder, limits and a single-use upload intent; returns timestamp, signature, cloud name, API key, folder and transformation constraints only.
3. Browser uploads directly to Cloudinary over HTTPS.
4. Browser sends the provider result to `/media/complete`.
5. Backend verifies signature/public ID, fetches or validates metadata, confirms folder/format/dimensions and creates `media_assets` plus usage.
6. Orphaned upload intents are cleaned by a scheduled backend job.

Signatures expire within five minutes. Rate limits apply per administrator and IP. Provider secrets never enter responses, logs or Vite variables.

## 5. Responsive Transformation Policy

Default delivery transformation: `f_auto,q_auto:good,dpr_auto` with allowlisted widths and crop mode from the asset matrix. Generated URLs are produced server-side or by a non-secret URL helper using stored public IDs.

- `cover`: `c_fill,g_xy_center` using stored focal point; never upscale beyond the master except DPR within a capped size.
- `contain`: `c_fit` with a template-controlled background where needed.
- Product zoom uses the original validated master or a maximum 1600 px delivery.
- Admin thumbnails use 160-320 px widths, not original assets.

## 6. Replacement and Deletion

- Replacement uploads and verifies the new asset before changing any usage.
- Usage reassignment occurs transactionally in Supabase.
- Old Cloudinary deletion is queued after database commit and retried safely.
- Deletion is blocked when `media_usages` exist. The UI lists every reference.
- Deleting an unreferenced asset creates an audit record and tombstone before provider deletion.
- Provider deletion failure leaves the tombstone retryable; it does not restore a removed reference automatically.
- Media used by historical order/invoice snapshots is retained even if a product is archived.

## 7. Content Safety

- File extensions are not trusted; decoded MIME and dimensions are checked.
- Reject polyglots, animated files, files above limits and impossible decompression ratios.
- Strip metadata and never preserve GPS/EXIF customer information.
- Review media requires moderation before public delivery.
- Alt text is plain text only. CTA URLs are separate validated fields, never embedded in media metadata.

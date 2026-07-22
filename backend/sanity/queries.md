# Royal Fusion Sanity Query Starters

Use these GROQ queries when wiring the frontend to Sanity.

## Published Blogs

```groq
*[_type == "blogPost" && status == "Published"] | order(publishedAt desc) {
  _id,
  title,
  "slug": slug.current,
  excerpt,
  "image": featuredImage.asset->url,
  imageAlt,
  "category": category->title,
  "author": author->name,
  tags,
  readTime,
  publishedAt,
  seoTitle,
  seoDescription
}
```

## Blog Detail

```groq
*[_type == "blogPost" && status == "Published" && slug.current == $slug][0] {
  _id,
  title,
  "slug": slug.current,
  excerpt,
  "image": featuredImage.asset->url,
  imageAlt,
  "category": category->title,
  "author": author->name,
  tags,
  readTime,
  publishedAt,
  body,
  seoTitle,
  seoDescription,
  "ogImage": ogImage.asset->url
}
```

## Homepage

```groq
*[_type == "homepage"][0] {
  heroHeading,
  heroSubtitle,
  "heroImage": heroImage.asset->url,
  primaryCtaText,
  primaryCtaLink,
  secondaryCtaText,
  secondaryCtaLink,
  collectionTitle,
  collectionCopy,
  giftTitle,
  giftCopy,
  newsletterTitle,
  newsletterCopy,
  featuredProductSlugs,
  featuredCategorySlugs
}
```

## Active Banners

```groq
*[_type == "banner" && enabled == true && (!defined(startDate) || startDate <= now()) && (!defined(endDate) || endDate >= now())] {
  title,
  subtitle,
  "image": image.asset->url,
  imageAlt,
  ctaText,
  ctaLink,
  position,
  startDate,
  endDate
}
```

## FAQs

```groq
*[_type == "faq" && enabled == true] | order(displayOrder asc) {
  question,
  answer
}
```

## Editable Page

```groq
*[_type == "policyPage" && status == "Published" && slug.current == $slug][0] {
  title,
  "slug": slug.current,
  pageType,
  body,
  seoTitle,
  seoDescription
}
```

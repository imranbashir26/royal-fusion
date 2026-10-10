import { defineQuery } from 'groq'

const published = '!(_id in path("drafts.**")) && !(_id in path("versions.**"))'
const articles = `_type == "blogPost" && ${published}`
const image = /* groq */ `
  _type,
  asset->{_id, _type, url, "metadata": {"dimensions": metadata.dimensions{width, height}}},
  defined(alt) => {alt},
  crop{top, bottom, left, right}, hotspot{x, y, width, height}, caption
`
const summary = /* groq */ `
  _id, _type, title, slug{current}, excerpt, publishedAt, _updatedAt,
  author->{_type == "author" && ${published} => {_id, _type, name, bio}},
  category->{_type == "blogCategory" && ${published} => {_id, _type, title, slug{current}, description}},
  featuredImage{${image}}, defined(imageAlt) => {imageAlt}, tags,
  seoTitle, seoDescription, canonicalUrl, "noIndex": coalesce(noIndex, false), ogImage{${image}}
`

// One request counts and slices the same published population; summaries never request bodies.
export const SANITY_BLOG_LIST_QUERY = defineQuery(/* groq */ `{
  "documents": *[${articles}] | order(dateTime(publishedAt) desc, _id asc) [$offset...$end] {
    ${summary},
    "_slugMatchCount": count(*[${articles} && slug.current == ^.slug.current])
  },
  "total": count(*[${articles}])
}`)

// Two results suffice to detect an ambiguous slug rather than selecting an arbitrary article.
export const SANITY_BLOG_DETAIL_QUERY = defineQuery(/* groq */ `
  *[${articles} && slug.current == $slug] | order(_id asc) [0...2] {
    ${summary},
    body[]{
      _type, _key,
      _type == "block" => {
        "style": coalesce(style, "normal"),
        children[]{_type, _key, text, "marks": coalesce(marks, [])},
        "markDefs": coalesce(markDefs[]{_type, _key, href}, []),
        defined(listItem) => {listItem}, defined(level) => {level}
      },
      _type == "image" => {${image}}
    }
  }
`)

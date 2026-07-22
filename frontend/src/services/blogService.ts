import { blogs } from '../data/blogs'
import type { BlogPost } from '../types'
import { apiClient } from './apiClient'
import { sanityContentService } from './sanityContentService'

async function getProductionBlogs() {
  try {
    return await sanityContentService.getBlogs()
  } catch (error) {
    console.warn('Sanity blogs unavailable. Falling back to local blogs.', error)
    return null
  }
}

export const blogService = {
  async getBlogs() {
    return await getProductionBlogs() ?? apiClient.get<BlogPost[]>(blogs)
  },
  async getBySlug(slug: string) {
    try {
      const productionBlog = await sanityContentService.getBlogBySlug(slug)
      if (productionBlog) return productionBlog
    } catch (error) {
      console.warn('Sanity blog detail unavailable. Falling back to local blog.', error)
    }
    const items = await this.getBlogs()
    return items.find((blog) => blog.slug === slug)
  },
}

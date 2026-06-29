import { blogs } from '../data/blogs'
import type { BlogPost } from '../types'
import { apiClient } from './apiClient'

export const blogService = {
  getBlogs: () => apiClient.get<BlogPost[]>(blogs),
  getBySlug: (slug: string) =>
    apiClient.get<BlogPost | undefined>(blogs.find((blog) => blog.slug === slug)),
}

import { categories } from '../data/categories'
import type { Category } from '../types'
import { apiClient } from './apiClient'

export const categoryService = {
  getCategories: () => import.meta.env.PROD ? Promise.resolve([]) : apiClient.get<Category[]>(categories),
}

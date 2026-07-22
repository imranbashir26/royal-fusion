import { categories } from '../data/categories'
import type { Category } from '../types'
import { apiClient } from './apiClient'

export const categoryService = {
  getCategories: () => apiClient.get<Category[]>(categories),
}

import { adminAuthClient } from './adminAuthClient'
import type { UploadMediaOptions, UploadMediaResult, DeleteMediaOptions } from './adminMediaContract'
export type { UploadMediaOptions, UploadMediaResult, DeleteMediaOptions } from './adminMediaContract'
export { mediaErrorMessage } from './adminMediaContract'

export const adminMediaApi = {
  async upload(file: File, options: UploadMediaOptions): Promise<UploadMediaResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('productId', options.productId)
    formData.append('mediaType', options.mediaType)
    if (options.altText) formData.append('altText', options.altText)
    if (typeof options.displayOrder === 'number') {
      formData.append('displayOrder', String(options.displayOrder))
    }

    return adminAuthClient.protectedRequest<UploadMediaResult>('/v1/admin/media', {
      method: 'POST',
      body: formData,
    })
  },

  async delete(
    options: DeleteMediaOptions
  ): Promise<{ success: boolean; productId: string; removedUrl?: string }> {
    return adminAuthClient.protectedRequest<{ success: boolean; productId: string; removedUrl?: string }>(
      '/v1/admin/media',
      {
        method: 'DELETE',
        body: JSON.stringify(options),
      }
    )
  },
}

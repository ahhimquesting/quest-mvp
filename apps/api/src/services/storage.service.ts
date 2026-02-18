export class StorageService {
  constructor(private r2: R2Bucket, private publicUrl: string) {}

  async uploadVideo(userId: string, fileId: string, body: ReadableStream | ArrayBuffer, contentType: string): Promise<string> {
    const key = `videos/${userId}/${fileId}`
    await this.r2.put(key, body, {
      httpMetadata: { contentType },
    })
    return `${this.publicUrl}/${key}`
  }

  async uploadFrame(claimId: string, frameIndex: number, body: ArrayBuffer): Promise<string> {
    const key = `frames/${claimId}/frame_${frameIndex.toString().padStart(3, '0')}.jpg`
    await this.r2.put(key, body, {
      httpMetadata: { contentType: 'image/jpeg' },
    })
    return key
  }

  async uploadThumbnail(claimId: string, body: ArrayBuffer): Promise<string> {
    const key = `thumbnails/${claimId}.jpg`
    await this.r2.put(key, body, {
      httpMetadata: { contentType: 'image/jpeg' },
    })
    return `${this.publicUrl}/${key}`
  }

  async getFrames(claimId: string): Promise<{ base64: string; mimeType: string }[]> {
    const frames: { base64: string; mimeType: string }[] = []
    const list = await this.r2.list({ prefix: `frames/${claimId}/` })

    for (const object of list.objects) {
      const data = await this.r2.get(object.key)
      if (data) {
        const arrayBuffer = await data.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
        frames.push({ base64, mimeType: 'image/jpeg' })
      }
    }

    return frames
  }

  async getVideoBlob(key: string): Promise<Blob | null> {
    const object = await this.r2.get(key)
    if (!object) return null
    return await object.blob()
  }

  videoKeyFromUrl(url: string): string {
    return url.replace(`${this.publicUrl}/`, '')
  }
}

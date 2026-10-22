import { ApiError } from './api';
export function uploadFile(file: File, onProgress?: (percent: number) => void): Promise<{ id: string; filename: string; mimeType: string; size: number; url: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');
    xhr.withCredentials = true;
    const csrf = document.cookie.split('; ').find(part => part.startsWith('cove_csrf='))?.split('=')[1];
    if (csrf) xhr.setRequestHeader('x-csrf-token', csrf);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data.attachment); else reject(new ApiError(xhr.status, data.error?.code || 'UPLOAD_FAILED', data.error?.message || 'Upload failed.')); }
      catch { reject(new Error('Upload failed. Please try again.')); }
    };
    xhr.onerror = () => reject(new Error('Upload interrupted. Check your connection.'));
    const body = new FormData(); body.append('file', file); xhr.send(body);
  });
}

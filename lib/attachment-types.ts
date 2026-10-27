export type Attachment = { id: string; name: string; size: number; type: string; url: string };
export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

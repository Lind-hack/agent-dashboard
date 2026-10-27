export type Attachment = { id: string; name: string; size: number; type: string; url: string };
export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

export const hideAttachmentPaths = (text: string) => text.replace(/\nVPS file: [^\n]+\nUse your file\/image tools[^\n]*/g, "");

import { templateLibraryPreview } from '../shared/workspace-url.ts';

const origin = (process.env.APP_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
console.log(JSON.stringify(templateLibraryPreview(origin)));

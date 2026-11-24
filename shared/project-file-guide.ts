export const projectFileInstruction = 'Use the selected project and file path. For paged text, keep the first fileVersion and use each nextOffset until truncated is false. To sync a complete local copy, pass its fileVersion as fromFileVersion. If a baseline is returned, download it before applying the patches in order. For binary files or a complete download, use download. If the link expires, repeat download with the same atFileVersion. Copy version tokens exactly as returned.';

export function projectFileExample(projectId = '<projectId>') {
  const path = 'index.html';
  const fileQueries = [
    { path, mode: 'read', length: 4096 },
    { path, mode: 'read', atFileVersion: '<first page fileVersion>', offset: 4096, length: 4096 },
    { path, mode: 'sync', fromFileVersion: '<local fileVersion>' },
    { path, mode: 'download', atFileVersion: '<target fileVersion>' },
  ];
  return fileQueries.map(file => `openmotion_get_project(${JSON.stringify({ projectId, file })})`).join('\n');
}
